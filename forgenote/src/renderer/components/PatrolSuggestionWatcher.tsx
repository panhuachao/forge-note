// 主动建议监听器（doc/AI智能管家重构方案.md §5.2 P2-5）
//
// 「管家」与「工具」的分水岭在于是否主动：本组件无需用户发起任何操作，
// 在应用启动后自动检查知识库体检结果，发现问题就轻提示一次。
//
// 节流策略（由主进程 patrol-service 实现）：
// - 同一问题（dedupeKey）7 天内不重复推送
// - 单轮最多推送 3 条
// - 只推 high / medium，low 级不打扰
//
// 性能考虑：全库扫描是同步读盘，因此延后到启动完成后再跑，
// 且优先使用 24h 内缓存，避免每次启动都卡一下。
import { useEffect, useRef } from 'react';
import { useKBStore } from '../stores/kb-store';

/** 启动后延迟执行，避开索引构建等启动高峰 */
const DELAY_MS = 8000;

export function PatrolSuggestionWatcher() {
  const activeKb = useKBStore((s) => s.activeKb);
  const pushToast = useKBStore((s) => s.pushToast);
  // 每个知识库每次会话只提示一轮
  const doneRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const kbId = activeKb?.id;
    if (!kbId) return;
    if (doneRef.current.has(kbId)) return;
    doneRef.current.add(kbId);

    const timer = setTimeout(async () => {
      try {
        // 无有效缓存时先跑一次巡检（24h 内已有报告则直接复用）
        let report = await window.forge.ai.getPatrolReport(kbId);
        if (!report) {
          report = await window.forge.ai.runPatrol(kbId, true);
        }
        const list = await window.forge.ai.getPatrolSuggestions(kbId);
        if (!list?.length) return;

        const high = list.filter((f) => f.severity === 'high').length;
        pushToast({
          level: high > 0 ? 'warn' : 'info',
          text: `知识库体检发现 ${list.length} 个问题${high > 0 ? `（${high} 项重要）` : ''}，可在「诊断」页查看并一键修复`,
          duration: 8000
        });
        // 标记已展示，进入静默期
        await window.forge.ai.markPatrolShown(
          kbId,
          list.map((f) => f.dedupeKey)
        );
      } catch {
        /* 主动建议失败必须静默：任何异常都不应打扰用户 */
      }
    }, DELAY_MS);

    return () => clearTimeout(timer);
  }, [activeKb?.id, pushToast]);

  return null;
}
