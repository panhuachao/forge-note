// 统一 AI 会话 Hook（见 doc/AI调用重构技术方案.md §4.2 / §7）
// 提供多轮上下文、确认执行、加载态与错误提示，替代各组件散落的 try/catch。
import { useCallback, useRef, useState } from 'react';
import { useKBStore } from './kb-store';
import { AISession, AITurn, AIResponse } from '@shared/types/ai';

interface UseAISessionOpts {
  skill: string;
  kbId?: string;
}

export function useAISession({ skill, kbId }: UseAISessionOpts) {
  const { activeKb, pushToast } = useKBStore();
  const resolvedKbId = kbId ?? activeKb?.id;
  const [session, setSession] = useState<AISession | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [last, setLast] = useState<AIResponse | null>(null);
  const [pendingDraft, setPendingDraft] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (input: Record<string, unknown>) => {
      const sid = session?.id;
      const req = {
        skill,
        input,
        kbId: resolvedKbId,
        sessionId: sid,
        confirm: false
      };
      setState('loading');
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = (await window.forge.ai.hubRun(req as any)) as AIResponse & { sessionId?: string };
        if (ac.signal.aborted) return;
        setSession((s) => (s && s.id === res.sessionId ? s : ({ id: res.sessionId!, skill, kbId: resolvedKbId, turns: [], createdAt: Date.now(), updatedAt: Date.now() } as AISession)));
        setLast(res);
        setPendingDraft(res.kind === 'structured' && res.pending ? res.data : null);
        setState('done');
        return res;
      } catch (e) {
        if (!ac.signal.aborted) {
          setState('error');
          pushToast({ level: 'error', text: String(e) });
        }
      }
    },
    [skill, resolvedKbId, session, pushToast]
  );

  // 确认上一轮 draft：发送 confirm=true，携带同一 sessionId
  const confirmDraft = useCallback(
    async (extra?: Record<string, unknown>) => {
      if (!session?.id) return;
      setState('loading');
      try {
        const res = (await window.forge.ai.hubRun({
          skill,
          input: { ...(extra || {}) },
          kbId: resolvedKbId,
          sessionId: session.id,
          confirm: true
        } as any)) as AIResponse & { sessionId?: string };
        setLast(res);
        setPendingDraft(null);
        setState('done');
        return res;
      } catch (e) {
        setState('error');
        pushToast({ level: 'error', text: String(e) });
      }
    },
    [skill, resolvedKbId, session, pushToast]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState('idle');
  }, []);

  return { session, state, last, pendingDraft, run, confirmDraft, cancel };
}

export type { AISession, AITurn };
