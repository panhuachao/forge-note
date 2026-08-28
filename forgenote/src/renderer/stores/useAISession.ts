// 统一 AI 会话 Hook（见 doc/AI调用重构技术方案.md §4.2 / §7
// 与 doc/AI智能管家重构方案.md §5.3 P1-4）
//
// 提供多轮上下文、流式渲染、工具调用活动、确认执行、取消与错误提示，
// 替代各组件散落的 try/catch + 手工订阅 onAIStream。
// 所有调用一律走 AIHub，不直接调用 window.forge.ai.<业务方法>。
import { useCallback, useRef, useState } from 'react';
import { useKBStore } from './kb-store';
import type { AIResponse, ConfirmableAction, ToolActivity } from '@shared/types/ai';

type SessionState = 'idle' | 'loading' | 'done' | 'error';

interface UseAISessionOpts {
  skill: string;
  kbId?: string;
  /** 外部托管的 sessionId（如持久化在会话对象上）；缺省则由本 Hook 内部维护 */
  sessionId?: string;
  /** 聚焦的笔记路径，随每次请求透传 */
  notePath?: string;
  /** sessionId 变化时回调，便于调用方持久化 */
  onSessionChange?: (sessionId: string) => void;
}

export function useAISession({ skill, kbId, sessionId, notePath, onSessionChange }: UseAISessionOpts) {
  const { activeKb, pushToast } = useKBStore();
  const resolvedKbId = kbId ?? activeKb?.id;

  const [innerSessionId, setInnerSessionId] = useState<string | undefined>(undefined);
  const effectiveSessionId = sessionId ?? innerSessionId;

  const [state, setState] = useState<SessionState>('idle');
  const [last, setLast] = useState<(AIResponse & { sessionId?: string }) | null>(null);
  const [pendingAction, setPendingAction] = useState<ConfirmableAction | null>(null);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  /** 执行后验证结果（P2-3）：ok=false 时 UI 应提示可回滚 */
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  /** 执行 / 回滚进行中 */
  const [actionBusy, setActionBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const applySession = useCallback(
    (sid?: string) => {
      if (!sid || sid === effectiveSessionId) return;
      setInnerSessionId(sid);
      onSessionChange?.(sid);
    },
    [effectiveSessionId, onSessionChange]
  );

  const applyResult = useCallback(
    (res: AIResponse & { sessionId?: string }) => {
      applySession(res.sessionId);
      setLast(res);
      // pending 表示「待用户确认的建议」，交调用方渲染确认卡片
      setPendingAction(res.kind === 'structured' && res.pending ? (res.data as ConfirmableAction) : null);
      setState('done');
      return res;
    },
    [applySession]
  );

  /** 非流式调用。opts.skill 可覆盖初始化时传入的 skill（如 agent / ask 切换） */
  const run = useCallback(
    async (input: Record<string, unknown>, opts?: { skill?: string }) => {
      if (!resolvedKbId) {
        pushToast({ level: 'warn', text: '请先打开一个知识库' });
        return null;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState('loading');
      try {
        const res = (await window.forge.ai.hubRun({
          skill: opts?.skill ?? skill,
          input: { ...input, notePath },
          kbId: resolvedKbId,
          sessionId: effectiveSessionId
        } as never)) as AIResponse & { sessionId?: string };
        if (ac.signal.aborted) return null;
        return applyResult(res);
      } catch (e) {
        if (!ac.signal.aborted) {
          setState('error');
          pushToast({ level: 'error', text: String(e) });
        }
        return null;
      }
    },
    [skill, resolvedKbId, effectiveSessionId, notePath, applyResult, pushToast]
  );

  /**
   * 流式调用：订阅 AI_STREAM_CHUNK，逐 token 回调 onToken。
   * 同时累积工具调用活动（agent / 时间路由），通过 onActivity 回传。
   */
  const runStream = useCallback(
    async (
      input: Record<string, unknown>,
      onToken: (delta: string) => void,
      opts?: { skill?: string; onActivity?: (list: ToolActivity[]) => void }
    ) => {
      if (!resolvedKbId) {
        pushToast({ level: 'warn', text: '请先打开一个知识库' });
        return null;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const acts: ToolActivity[] = [];
      setTools([]);
      setState('loading');

      const off = window.forge.ai.onAIStream((chunk) => {
        if (chunk.streamId !== streamId) return;
        onToken(chunk.delta);
      });
      const offAct = window.forge.ai.onToolActivity?.((chunk) => {
        if (chunk.streamId !== streamId) return;
        acts.push(chunk.activity as ToolActivity);
        setTools([...acts]);
        opts?.onActivity?.([...acts]);
      });

      try {
        const res = (await window.forge.ai.hubRunStream({
          skill: opts?.skill ?? skill,
          input: { ...input, notePath },
          kbId: resolvedKbId,
          sessionId: effectiveSessionId,
          streamId
        } as never)) as AIResponse & { sessionId?: string };
        off();
        offAct?.();
        if (ac.signal.aborted) return null;
        return applyResult(res);
      } catch (e) {
        off();
        offAct?.();
        if (!ac.signal.aborted) {
          setState('error');
          pushToast({ level: 'error', text: String(e) });
        }
        return null;
      }
    },
    [skill, resolvedKbId, effectiveSessionId, notePath, applyResult, pushToast]
  );

  /**
   * 确认执行上一轮 pending 建议（Confirm-then-Act 第二轮）。
   * 携带同一 sessionId + confirm:true + draft，主进程执行的是「预览过的那一版」，
   * 不会让模型重新生成内容，保证所见即所改。
   */
  const confirmDraft = useCallback(
    async (action: ConfirmableAction, opts?: { skill?: string; note?: string }) => {
      if (!resolvedKbId || !action) return null;
      const note = opts?.note ?? '确认执行上述修改';
      setState('loading');
      setVerifyResult(null);
      try {
        const res = (await window.forge.ai.hubRun({
          skill: opts?.skill ?? skill,
          input: { text: note, question: note, notePath },
          kbId: resolvedKbId,
          sessionId: effectiveSessionId,
          confirm: true,
          draft: action
        } as never)) as AIResponse & { sessionId?: string };
        setPendingAction(null);
        const out = applyResult(res);
        // 执行后自动验证：确认修改真的落到了笔记里（P2-3）
        try {
          const v = await window.forge.ai.verifyAction(action, resolvedKbId);
          setVerifyResult(v);
          if (!v.ok) pushToast({ level: 'warn', text: `${v.message}（可回滚）` });
        } catch {
          /* 验证失败不阻断主流程 */
        }
        return out;
      } catch (e) {
        setState('error');
        pushToast({ level: 'error', text: '执行失败：' + String(e) });
        return null;
      }
    },
    [skill, resolvedKbId, effectiveSessionId, notePath, applyResult, pushToast]
  );

  /** 回滚已执行的操作，恢复到修改前的内容 */
  const rollback = useCallback(
    async (action: ConfirmableAction) => {
      if (!resolvedKbId || !action) return null;
      setActionBusy(true);
      try {
        const r = await window.forge.ai.rollbackAction(action, resolvedKbId);
        if (r.ok) setVerifyResult(null);
        else pushToast({ level: 'error', text: r.message });
        return r;
      } catch (e) {
        const r = { ok: false, message: `回滚失败：${String(e)}` };
        pushToast({ level: 'error', text: r.message });
        return r;
      } finally {
        setActionBusy(false);
      }
    },
    [resolvedKbId, pushToast]
  );

  /** 放弃当前待确认建议（保留会话上下文，仅清除建议卡片） */
  const dismissPending = useCallback(() => {
    setPendingAction(null);
  }, []);

  /** 关闭验证结果提示条 */
  const clearVerify = useCallback(() => {
    setVerifyResult(null);
  }, []);

  /** 取消当前请求（停止接收流式内容） */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('idle');
  }, []);

  /** 重置状态（如切换会话 / 切换笔记时） */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('idle');
    setLast(null);
    setPendingAction(null);
    setTools([]);
  }, []);

  return {
    sessionId: effectiveSessionId,
    state,
    last,
    pendingAction,
    tools,
    verifyResult,
    actionBusy,
    run,
    runStream,
    confirmDraft,
    dismissPending,
    rollback,
    clearVerify,
    cancel,
    reset
  };
}

export type { SessionState };
