import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKBStore, requireAI } from '../stores/kb-store';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';
import { hubRun, hubText, hubConfirm, hubExecute, hubVerify, hubRollback } from '../utils/ai-hub';
import { PatrolReportCard } from '../components/PatrolReportCard';
import type { TreeNode } from '@shared/types';
import type { ConfirmableAction, PatrolReport } from '@shared/types/ai';

type DiagType =
  | 'missing_link' // 缺少双链
  | 'wrong_dir' // 归属目录错误
  | 'missing_dir' // 缺少目录
  | 'orphan' // 孤立笔记
  | 'duplicate'; // 重复/冗余

type Severity = 'high' | 'medium' | 'low';

interface DiagItem {
  type: DiagType;
  severity: Severity;
  title: string;
  detail: string;
  note?: string; // 受影响笔记路径
  target?: string; // 双链目标路径 或 应归属目录路径
  dirName?: string; // 新建目录名（missing_dir）
  action: string; // AI 建议的修正动作（自然语言）
  status?: 'idle' | 'doing' | 'confirming' | 'done' | 'error';
  msg?: string;
  /** 待确认的写操作（Confirm-then-Act：应用前先出预览，用户确认才落盘） */
  pending?: ConfirmableAction;
}

const TYPE_META: Record<DiagType, { label: string; color: string; icon: any }> = {
  missing_link: { label: '缺双链', color: 'text-amber-600 bg-amber-500/10', icon: 'link' },
  wrong_dir: { label: '归属存疑', color: 'text-purple-600 bg-purple-500/10', icon: 'arrows-right-left' },
  missing_dir: { label: '缺目录', color: 'text-sky-600 bg-sky-500/10', icon: 'folder-plus' },
  orphan: { label: '孤立笔记', color: 'text-fg-muted bg-canvas', icon: 'document' },
  duplicate: { label: '可能重复', color: 'text-rose-600 bg-rose-500/10', icon: 'document-duplicate' }
};

const SEV_LABEL: Record<Severity, { label: string; cls: string }> = {
  high: { label: '重要', cls: 'text-red-600 bg-red-500/10' },
  medium: { label: '建议', cls: 'text-amber-600 bg-amber-500/10' },
  low: { label: '可选', cls: 'text-fg-muted bg-canvas' }
};

function collectMd(node: any, out: any[] = []) {
  if (node.kind === 'file' && node.path.endsWith('.md')) out.push(node);
  if (node.children) for (const c of node.children) collectMd(c, out);
  return out;
}

function basename(p: string) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
function dirOf(p: string) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

// 把 AI 推荐的目录路径解析为知识库中真实存在的目录；若推荐子目录不存在，回退到最近存在的父目录（至少一级目录），不会创建新目录。
function resolveTargetDir(tree: TreeNode, target: string): string | null {
  const clean = target
    .replace(/\.md$/i, '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!clean) return null;
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  let current = tree;
  let matched = 0;
  for (const part of parts) {
    const child = current.children?.find((c) => c.kind === 'dir' && c.name === part);
    if (!child) break;
    current = child;
    matched++;
  }

  if (matched === 0) return null;
  return parts.slice(0, matched).join('/');
}

export function DiagnosePage() {
  const { activeKb, pushToast, setTree, tree } = useKBStore();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DiagItem[]>([]);
  const [progress, setProgress] = useState('');
  const cancelledRef = useRef(false);

  // 知识库体检（P2-1）：规则类检查，不依赖 AI 模型
  const [patrol, setPatrol] = useState<PatrolReport | null>(null);
  const [patrolBusy, setPatrolBusy] = useState(false);
  const [patrolVerify, setPatrolVerify] = useState<{ ok: boolean; message: string } | null>(null);
  const lastPatrolActionRef = useRef<ConfirmableAction | null>(null);

  /** 读取缓存报告（24h 内有效）；force 时强制重新扫描 */
  const loadPatrol = useCallback(
    async (force: boolean) => {
      if (!activeKb) return;
      setPatrolBusy(true);
      try {
        const r = force
          ? await window.forge.ai.runPatrol(activeKb.id, true)
          : await window.forge.ai.getPatrolReport(activeKb.id);
        setPatrol(r ?? null);
      } catch (e) {
        pushToast({ level: 'error', text: '体检失败：' + String(e) });
      } finally {
        setPatrolBusy(false);
      }
    },
    [activeKb, pushToast]
  );

  // 切换知识库时载入缓存报告（不自动重新扫描，避免大库卡顿）
  useEffect(() => {
    setPatrol(null);
    setPatrolVerify(null);
    if (activeKb) void loadPatrol(false);
  }, [activeKb?.id]);

  /** 确认执行巡检建议：直接走 actionService，不需要模型参与 */
  const applyPatrolSuggestion = async (action: ConfirmableAction) => {
    if (!activeKb) return;
    setPatrolBusy(true);
    setPatrolVerify(null);
    lastPatrolActionRef.current = action;
    try {
      const r = await hubExecute(action, activeKb.id);
      pushToast({ level: r?.ok ? 'success' : 'error', text: r?.message ?? '已执行' });
      if (r?.ok) {
        // 执行后自动验证（P2-3）
        const v = await hubVerify(action, activeKb.id);
        setPatrolVerify(v);
      }
    } catch (e) {
      pushToast({ level: 'error', text: '执行失败：' + String(e) });
    } finally {
      setPatrolBusy(false);
    }
  };

  /** 回滚上一次巡检修复 */
  const rollbackPatrol = async () => {
    const action = lastPatrolActionRef.current;
    if (!activeKb || !action) return;
    setPatrolBusy(true);
    try {
      const r = await hubRollback(action, activeKb.id);
      pushToast({ level: r?.ok ? 'success' : 'error', text: r?.message });
      if (r?.ok) lastPatrolActionRef.current = null;
    } finally {
      setPatrolBusy(false);
    }
  };

  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const it of items) byType[it.type] = (byType[it.type] || 0) + 1;
    const pending = items.filter((i) => i.status !== 'done' && i.status !== 'error').length;
    return { byType, pending, total: items.length };
  }, [items]);

  async function runDiagnose() {
    if (!activeKb) return;
    // 未配置 AI 模型时直接拒绝执行：避免无 AI 时跑完 file walk + ask 拿到空解析再 toast “诊断完成”，误导用户以为结构良好
    if (!requireAI()) {
      pushToast({ level: 'warn', text: '请先在「设置」中配置 AI 模型' });
      return;
    }
    cancelledRef.current = false;
    setLoading(true);
    setItems([]);
    setProgress('正在读取笔记…');
    try {
      const tree = await window.forge.fs.listTree(activeKb.id);
      const files = collectMd(tree);
      const notes: { path: string; dir: string; title: string; outlinks: string[] }[] = [];
      for (const f of files) {
        if (cancelledRef.current) return;
        setProgress(`正在读取笔记（${notes.length + 1}/${files.length}）`);
        try {
          const c = await window.forge.fs.readNote(activeKb.id, f.path);
          const fm = c.frontmatter || {};
          const title =
            (typeof fm.title === 'string' && fm.title) ||
            f.name.replace(/\.md$/, '');
          notes.push({ path: f.path, dir: dirOf(f.path), title, outlinks: c.outlinks || [] });
        } catch {
          // 跳过读取失败的笔记
        }
      }
      if (cancelledRef.current) return;
      setProgress('AI 正在分析知识库结构…');
      const prompt = buildPrompt(notes);
      const raw = await hubText({ skill: 'ask', input: { text: prompt, question: prompt }, kbId: activeKb.id });
      const parsed = parseDiag(raw);
      setItems(parsed);
      setProgress('');
      if (parsed.length === 0) {
        pushToast({ level: 'success', text: '诊断完成：未发现明显问题，知识库结构良好' });
      } else {
        pushToast({ level: 'info', text: `诊断完成：共发现 ${parsed.length} 项建议` });
      }
    } catch (e) {
      setProgress('');
      setItems([]);
      pushToast({ level: 'error', text: '诊断失败：' + String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function applyItem(idx: number) {
    if (!activeKb) return;
    if (!requireAI()) return;
    const it = items[idx];
    if (!it) return;
    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, status: 'doing', msg: '' } : p)));
    try {
      if (it.type === 'missing_link' && it.note && it.target) {
        // 写操作先出预览（Confirm-then-Act），用户确认后才写盘
        // AI 返回的 target 形如 [[标题]]，这里剥掉外层括号，避免与工具内的 [[]] 包装重复
        const target = it.target.replace(/^\[\[|\]\]$/g, '').trim();
        const res = await hubRun({
          skill: 'insert-links',
          input: { text: it.note, notePath: it.note, targets: [target] },
          kbId: activeKb.id
        });
        if (res.kind === 'structured' && res.pending && res.data) {
          setItems((prev) =>
            prev.map((p, i) =>
              i === idx ? { ...p, status: 'confirming', msg: '', pending: res.data as ConfirmableAction } : p
            )
          );
          return;
        }
        // 未产出待确认建议（如该链接已存在），按提示处理
        setItems((prev) =>
          prev.map((p, i) =>
            i === idx ? { ...p, status: 'done', msg: res.kind === 'text' ? res.text : '无需修改' } : p
          )
        );
        return;
      } else if (it.type === 'wrong_dir' && it.note && it.target) {
        const currentTree = tree || (await window.forge.fs.listTree(activeKb.id));
        const dest = resolveTargetDir(currentTree, it.target);
        if (!dest) {
          throw new Error(`AI 推荐目录不存在：${it.target}（请先在知识库创建该目录）`);
        }
        await window.forge.fs.moveNote(activeKb.id, it.note, dest, { autoCreateDir: false });
      } else if (it.type === 'missing_dir' && it.dirName) {
        await window.forge.fs.createDir(activeKb.id, '', it.dirName);
      } else {
        // orphan / duplicate 暂无强自动动作，标记为已确认
        setItems((prev) =>
          prev.map((p, i) =>
            i === idx ? { ...p, status: 'done', msg: '已确认（无需自动修改）' } : p
          )
        );
        pushToast({ level: 'info', text: '已确认该建议' });
        return;
      }
      setTree(await window.forge.fs.listTree(activeKb.id));
      setItems((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, status: 'done', msg: '已应用' } : p))
      );
      pushToast({ level: 'success', text: '已应用修正' });
    } catch (e) {
      setItems((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, status: 'error', msg: String(e) } : p))
      );
      pushToast({ level: 'error', text: '应用失败：' + String(e) });
    }
  }

  /** 用户确认后执行待确认的写操作（Confirm-then-Act 第二轮） */
  async function confirmApply(idx: number) {
    if (!activeKb) return;
    const it = items[idx];
    if (!it?.pending) return;
    const notePath = it.note ?? '';
    setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, status: 'doing', msg: '' } : p)));
    try {
      const res = await hubConfirm(
        { skill: 'insert-links', input: { text: notePath, notePath }, kbId: activeKb.id },
        it.pending
      );
      setItems((prev) =>
        prev.map((p, i) =>
          i === idx
            ? { ...p, status: 'done', msg: res.kind === 'text' ? res.text : '已应用', pending: undefined }
            : p
        )
      );
      setTree(await window.forge.fs.listTree(activeKb.id));
      pushToast({ level: 'success', text: '已应用修正' });
    } catch (e) {
      setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, status: 'error', msg: String(e) } : p)));
      pushToast({ level: 'error', text: '应用失败：' + String(e) });
    }
  }

  function dismissItem(idx: number) {
    setItems((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, status: 'done', msg: '已忽略' } : p))
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <PageHeader icon="viewfinder-circle" title="知识库诊断">
        <button
          onClick={runDiagnose}
          disabled={loading || !activeKb}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-colors bg-brand text-brand-fg hover:bg-brand-hover disabled:opacity-50"
        >
          {loading ? (
            <>
              <Icon name="arrow-path" className="w-3.5 h-3.5 animate-spin" />
              诊断中…
            </>
          ) : (
            <>
              <Icon name="sparkles" className="w-3.5 h-3.5" />
              {items.length > 0 ? '重新诊断' : '开始诊断'}
            </>
          )}
        </button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto pt-14">
        <div className="w-full max-w-4xl mx-auto p-6">
          {/* 知识库体检：规则类检查，无需 AI 模型即可运行（P2-1） */}
          {activeKb && (
            <div className="mb-5">
              <PatrolReportCard
                report={patrol}
                busy={patrolBusy}
                onRefresh={loadPatrol}
                onApply={applyPatrolSuggestion}
                onRollback={rollbackPatrol}
                verify={patrolVerify}
                onDismissVerify={() => setPatrolVerify(null)}
              />
            </div>
          )}
          {!activeKb ? (
            <EmptyState text="请先在「首页」选择知识库" />
          ) : items.length === 0 && !loading ? (
            <div className="rounded-2xl border border-border-soft bg-content shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-8 text-center">
              <div className="relative mb-5 inline-block">
                <div className="absolute inset-0 rounded-3xl bg-brand/10 blur-xl" />
                <div className="relative w-16 h-16 rounded-3xl bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(220,38,38,0.4)]">
                  <Icon name="viewfinder-circle" className="w-8 h-8 text-white" />
                </div>
              </div>
              <div className="text-base font-medium text-fg mb-2">让 AI 为你的知识库体检</div>
              <div className="text-xs text-fg-muted max-w-md leading-relaxed mb-5 mx-auto">
                一键扫描整库：发现缺失的双链并建议补充、识别归属目录存疑的笔记、提示应新增的分类目录，
                并找出孤立/冗余笔记。每条建议可逐一确认，由 AI 自动修正。
              </div>
              <button
                onClick={runDiagnose}
                className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm font-medium bg-brand text-brand-fg hover:bg-brand-hover transition-colors"
              >
                <Icon name="sparkles" className="w-4 h-4" />
                开始诊断
              </button>
            </div>
          ) : loading ? (
            <div className="rounded-2xl border border-border-soft bg-content p-8 text-center">
              <Icon name="arrow-path" className="w-6 h-6 text-brand animate-spin mx-auto mb-3" />
              <div className="text-sm text-fg-muted">{progress || '正在分析…'}</div>
            </div>
          ) : (
            <>
              {/* 概览 */}
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <span className="text-xs text-fg-muted">
                  共发现 <span className="font-medium text-fg">{stats.total}</span> 项建议，
                  待处理 <span className="font-medium text-fg">{stats.pending}</span> 项
                </span>
                {Object.entries(stats.byType).map(([t, n]) => {
                  const m = TYPE_META[t as DiagType];
                  if (!m) return null;
                  return (
                    <span
                      key={t}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${m.color}`}
                    >
                      <Icon name={m.icon} className="w-3 h-3" />
                      {m.label} {n}
                    </span>
                  );
                })}
              </div>

              {/* 建议列表 */}
              <div className="flex flex-col gap-3">
                {items.map((it, idx) => {
                  const tm = TYPE_META[it.type];
                  const sv = SEV_LABEL[it.severity] || SEV_LABEL.low;
                  const done = it.status === 'done';
                  const err = it.status === 'error';
                  const confirming = it.status === 'confirming';
                  const pv = it.pending?.preview as { affectedLines?: number } | undefined;
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border bg-content p-4 transition-all ${
                        done ? 'border-border-soft opacity-60' : 'border-border-soft'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${tm.color}`}>
                          <Icon name={tm.icon} className="w-3 h-3" />
                          {tm.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-fg">{it.title}</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${sv.cls}`}>
                              {sv.label}
                            </span>
                          </div>
                          <p className="text-xs text-fg-muted leading-relaxed">{it.detail}</p>
                          {it.note && (
                            <div className="mt-2 text-[11px] text-fg-faint">
                              笔记：<code className="text-fg-muted">{it.note}</code>
                            </div>
                          )}
                          {it.target && (
                            <div className="text-[11px] text-fg-faint">
                              目标：<code className="text-fg-muted">{it.target}</code>
                            </div>
                          )}
                          {it.msg && (
                            <div className={`mt-2 text-[11px] ${err ? 'text-red-500' : 'text-emerald-600'}`}>
                              {it.msg}
                            </div>
                          )}
                          {confirming && (
                            <div className="mt-2 text-[11px] text-fg-muted">
                              确认后将写入「<code className="text-fg-muted">{it.note}</code>」
                              {pv?.affectedLines ? `，影响 ${pv.affectedLines} 处` : ''}
                            </div>
                          )}
                        </div>
                        {/* 操作 */}
                        <div className="shrink-0 flex flex-col gap-1.5">
                          {confirming ? (
                            <>
                              <button
                                onClick={() => confirmApply(idx)}
                                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs bg-brand text-brand-fg hover:bg-brand-hover"
                              >
                                <Icon name="check" className="w-3 h-3" />
                                确认修改
                              </button>
                              <button
                                onClick={() => dismissItem(idx)}
                                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs border border-border-soft text-fg-muted hover:bg-hover-bg"
                              >
                                <Icon name="x-mark" className="w-3 h-3" />
                                放弃
                              </button>
                            </>
                          ) : done ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                              <Icon name="check" className="w-3.5 h-3.5" />
                              {err ? '失败' : '已处理'}
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => applyItem(idx)}
                                disabled={it.status === 'doing'}
                                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs bg-brand text-brand-fg hover:bg-brand-hover disabled:opacity-50"
                              >
                                {it.status === 'doing' ? (
                                  <Icon name="arrow-path" className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Icon name="sparkles" className="w-3 h-3" />
                                )}
                                应用
                              </button>
                              <button
                                onClick={() => dismissItem(idx)}
                                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs border border-border-soft text-fg-muted hover:bg-hover-bg"
                              >
                                <Icon name="x-mark" className="w-3 h-3" />
                                忽略
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-center px-8 text-fg-faint">
      <div className="text-sm">{text}</div>
    </div>
  );
}

function buildPrompt(notes: { path: string; dir: string; title: string; outlinks: string[] }[]) {
  const list = notes
    .map((n, i) => {
      const links = n.outlinks.length ? n.outlinks.join('、') : '（无）';
      return `${i + 1}. 路径=${n.path} | 目录=${n.dir || '根'} | 标题=${n.title} | 现有双链=${links}`;
    })
    .join('\n');
  return `你是一位个人知识库整理顾问。下面是当前知识库的全部笔记清单（含路径、所属目录、标题、已有双链）。请诊断整体结构问题，并用严格的 JSON 数组返回建议（不要输出多余文字，只输出 JSON）。

诊断维度：
1. missing_link（缺双链）：某笔记内容明显应引用另一篇笔记，但缺少 [[另一篇标题]] 双链。
2. wrong_dir（归属存疑）：某笔记主题与其所在目录不符，应归属到更合适的已有目录（target 写目标目录路径，如 "00 灵感库" 或 "03 外部资源/展会"；必须是知识库中真实存在的目录，优先精准子目录，子目录不存在时回退到已有的一级目录，禁止建议不存在的目录，禁止返回文件路径或带 .md 的路径）。
3. missing_dir（缺目录）：知识库缺少某个明显应有的分类目录（dirName 写新目录名，如 "读书笔记"）。
4. orphan（孤立笔记）：没有任何入链/出链、且与其他笔记主题无关联的孤立笔记。
5. duplicate（可能重复）：两篇笔记主题高度重复、可合并。

要求：
- 仅输出 JSON 数组，元素字段：type(上述枚举)、severity("high"|"medium"|"low")、title(简短中文标题)、detail(具体说明)、note(受影响笔记路径，orphan/duplicate 时给主笔记路径)、target(双链目标路径或目标目录路径，缺失可不填)、dirName(新建目录名，仅 missing_dir 填)、action(建议的修正动作描述)。
- target 中的双链目标必须是清单中真实存在的笔记路径（用 [[标题]] 形式），不要编造不存在的笔记。
- target 中的目录路径必须是知识库中真实存在的目录（可含子目录），不要编造不存在的目录，不要返回文件路径或带 .md 后缀的路径。
- 每条建议都要具体、可操作，避免空泛。最多 30 条。

笔记清单：
${list}`;
}

function parseDiag(raw: string): DiagItem[] {
  try {
    let s = raw.trim();
    // 去掉 ```json ... ``` 包裹
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // 取第一个 [ 到最后一个 ]
    const a = s.indexOf('[');
    const b = s.lastIndexOf(']');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === 'object')
      .map((x: any) => ({
        type: x.type || 'orphan',
        severity: x.severity || 'low',
        title: String(x.title || '建议').slice(0, 80),
        detail: String(x.detail || x.action || '').slice(0, 400),
        note: x.note ? String(x.note) : undefined,
        target: x.target ? String(x.target) : undefined,
        dirName: x.dirName ? String(x.dirName) : undefined,
        action: String(x.action || ''),
        status: 'idle'
      }));
  } catch {
    return [];
  }
}
