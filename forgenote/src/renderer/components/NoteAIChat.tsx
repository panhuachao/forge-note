import { useState, useRef, useEffect } from 'react';
import { Icon } from './Icon';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import { isAIConfigured } from '../stores/kb-store';
import { ConfirmableActionCard } from './ConfirmableActionCard';
import type { ConfirmableAction, ToolActivity } from '@shared/types/ai';

interface Message {
  role: 'user' | 'ai';
  text: string;
  /** 智能体模式下调用的工具（气泡展示） */
  toolActivity?: ToolActivity[];
}

interface Props {
  kbId: string;
  notePath: string;
  onAppend?: (text: string) => void;
}

const SUGGESTIONS = [
  '用一句话总结这篇笔记',
  '列出本文的关键结论',
  '帮我润色并补充缺失部分',
  '指出本文可能的逻辑漏洞'
];

/**
 * 围绕当前笔记的 AI 聊天面板。
 * - 普通模式：主进程 askAboutNote 注入笔记上下文（快、只读）。
 * - 智能体模式：走 AIHub 的 agent skill，AI 可主动调用知识库 MCP 工具；
 *   涉及修改时只产出「待确认建议」，用户确认后才写盘（doc/MCP技术实现方案.md）。
 */
export function NoteAIChat({ kbId, notePath, onAppend }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 智能体模式：开启后 AI 可调用工具，修改类操作走「建议 → 确认 → 执行」
  const [agentMode, setAgentMode] = useState(false);
  // AI 会话 id（多轮上下文，与 ChatPage 的 convSessionMap 同思路）
  const sessionRef = useRef<string | undefined>(undefined);
  // 流式输出缓冲 + 工具调用活动
  const [streaming, setStreaming] = useState('');
  const [liveTools, setLiveTools] = useState<ToolActivity[]>([]);
  // 待确认操作
  const [pendingAction, setPendingAction] = useState<ConfirmableAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streaming, pendingAction]);

  // 切换笔记时重置会话与未处理的建议
  useEffect(() => {
    sessionRef.current = undefined;
    setMessages([]);
    setPendingAction(null);
  }, [notePath]);

  const genStreamId = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  /** 当用户只回复「继续」等词时，追加指令让模型直接生成预览，而不是再次询问 */
  const withContinueDirective = (q: string) => {
    if (/^(继续|是的|确认|好|生成预览|按你说的做|继续修改)$/i.test(q.trim())) {
      return `${q.trim()}（请按之前提出的计划，立即调用 kb_preview_patch 生成修改预览，并输出 \`\`\`json 建议块。不要再询问）`;
    }
    return q;
  };

  /** 智能体模式：走 AIHub agent skill */
  const sendAgent = async (question: string) => {
    const directed = withContinueDirective(question);
    const streamId = genStreamId();
    let acc = '';
    const toolActs: ToolActivity[] = [];
    setLiveTools([]);
    const off = window.forge.ai.onAIStream((chunk) => {
      if (chunk.streamId !== streamId) return;
      acc += chunk.delta;
      setStreaming(acc);
    });
    const offAct = window.forge.ai.onToolActivity?.((chunk) => {
      if (chunk.streamId !== streamId) return;
      toolActs.push(chunk.activity as ToolActivity);
      setLiveTools([...toolActs]);
    });
    try {
      const res = (await window.forge.ai.hubRunStream({
        skill: 'agent',
        input: { text: directed, question: directed, notePath },
        kbId,
        sessionId: sessionRef.current,
        streamId
      } as any)) as any;
      off();
      offAct?.();
      if (res?.sessionId) sessionRef.current = res.sessionId;
      // 待确认建议：渲染确认卡片，不落为普通消息
      if (res?.kind === 'structured' && res.pending && res.data) {
        setStreaming('');
        setPendingAction(res.data as ConfirmableAction);
        return;
      }
      const text = res?.kind === 'text' ? res.text : acc || '（AI 未返回内容）';
      setStreaming('');
      setMessages((m) => [...m, { role: 'ai', text, toolActivity: toolActs.length ? toolActs : undefined }]);
    } catch (e) {
      off();
      offAct?.();
      setStreaming('');
      setMessages((m) => [...m, { role: 'ai', text: '出错了：' + String(e) }]);
    } finally {
      setLiveTools([]);
    }
  };

  /** 普通模式：主进程注入笔记上下文后单次问答 */
  const sendPlain = async (question: string) => {
    try {
      const ans = await window.forge.ai.askAboutNote(kbId, notePath, question);
      setMessages((m) => [...m, { role: 'ai', text: ans || '（无回答）' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'ai', text: '出错了：' + String(e) }]);
    }
  };

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!kbId || !question || loading) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    if (!isAIConfigured()) {
      setMessages((m) => [
        ...m,
        {
          role: 'ai',
          text: '当前无 AI 模型可用，无法进行智能回复，请前往设置页面进行配置。'
        }
      ]);
      return;
    }
    setLoading(true);
    try {
      if (agentMode) await sendAgent(question);
      else await sendPlain(question);
    } finally {
      setLoading(false);
    }
  }

  /** 用户确认执行 AI 建议（doc/MCP技术实现方案.md §5.3） */
  const confirmPendingAction = async (action: ConfirmableAction) => {
    setPendingAction(null);
    setActionBusy(true);
    setLoading(true);
    const streamId = genStreamId();
    let acc = '';
    const off = window.forge.ai.onAIStream((chunk) => {
      if (chunk.streamId !== streamId) return;
      acc += chunk.delta;
      setStreaming(acc);
    });
    try {
      const res = (await window.forge.ai.hubRunStream({
        skill: 'agent',
        input: { text: '确认执行上述修改', question: '确认执行上述修改', notePath },
        kbId,
        sessionId: sessionRef.current,
        confirm: true,
        draft: action,
        streamId
      } as any)) as any;
      off();
      if (res?.sessionId) sessionRef.current = res.sessionId;
      const text = res?.kind === 'text' ? res.text : acc || '（已执行）';
      setStreaming('');
      setMessages((m) => [...m, { role: 'ai', text }]);
    } catch (e) {
      off();
      setStreaming('');
      setMessages((m) => [...m, { role: 'ai', text: '执行失败：' + String(e) }]);
    } finally {
      setActionBusy(false);
      setLoading(false);
    }
  };

  const copy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(idx);
      setTimeout(() => setCopiedId((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4 text-sm">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="text-fg-faint text-xs mb-4 leading-relaxed">
              已将该笔记作为上下文。<br />
              向 AI 提问以延展、总结或完善这篇笔记。
            </div>
            <div className="flex flex-wrap gap-1.5 px-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border-soft text-fg-secondary hover:bg-hover-bg hover:text-fg transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[92%]">
              <div
                className={`rounded-2xl px-3.5 py-2.5 ${
                  m.role === 'user'
                    ? 'bg-brand text-brand-fg'
                    : 'bg-hover-bg text-fg leading-relaxed'
                }`}
              >
                {m.role === 'user' ? (
                  <span className="whitespace-pre-wrap break-words">{m.text}</span>
                ) : (
                  <div
                    className="markdown-preview chat-md text-[13px] leading-relaxed break-words"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdownPreview(m.text, kbId, notePath)
                    }}
                  />
                )}
              </div>
              {/* 工具调用气泡（智能体模式） */}
              {m.role === 'ai' && m.toolActivity && m.toolActivity.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-1">
                  <span className="text-[10px] text-fg-faint px-1">工具调用</span>
                  {m.toolActivity.map((a, ai) => (
                    <details key={ai} className="px-2.5 py-1 rounded-lg bg-hover-bg border border-border-soft">
                      <summary className="flex items-center gap-1.5 cursor-pointer text-[11px] text-fg-secondary">
                        <Icon name="bolt" className="w-3 h-3 text-brand" />
                        <span className="font-mono text-brand">{a.name}</span>
                        <span className="text-fg-faint">{String(a.result || '').slice(0, 40)}</span>
                      </summary>
                      <pre className="mt-1 text-[10px] text-fg-secondary whitespace-pre-wrap break-all">
                        {JSON.stringify(a.args, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              )}
              {m.role === 'ai' && (
                <div className="flex gap-2 mt-1.5 pl-1">
                  <button
                    onClick={() => copy(m.text, i)}
                    className="text-[11px] px-2 py-1 rounded-md text-fg-secondary hover:bg-hover-bg hover:text-fg transition-colors inline-flex items-center gap-1"
                    title="复制回答"
                  >
                    <Icon name={copiedId === i ? 'check-circle' : 'clipboard'} className="w-3.5 h-3.5" />
                    {copiedId === i ? '已复制' : '复制'}
                  </button>
                  <button
                    onClick={() => onAppend?.(m.text)}
                    className="text-[11px] px-2 py-1 rounded-md border border-border-soft text-fg-secondary hover:bg-hover-bg hover:text-fg transition-colors inline-flex items-center gap-1"
                    title="AI 将结合此回复与现有笔记内容、格式，重新完善整篇文章"
                  >
                    <Icon name="plus" className="w-3 h-3" />
                    追加到笔记
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* 流式输出中 */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-2xl px-3.5 py-2.5 bg-hover-bg text-fg text-[13px] leading-relaxed whitespace-pre-wrap break-words">
              {streaming}
              <span className="inline-block w-1.5 h-4 align-middle bg-brand animate-pulse ml-0.5" />
            </div>
          </div>
        )}

        {/* 实时工具调用气泡 */}
        {liveTools.length > 0 && (
          <div className="flex flex-col gap-1">
            {liveTools.map((a, ai) => (
              <div
                key={ai}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-hover-bg border border-border-soft text-[11px] text-fg-secondary"
              >
                <Icon name="bolt" className="w-3 h-3 text-brand" />
                <span className="font-mono text-brand">{a.name}</span>
                <span className="text-fg-faint">{String(a.result || '').slice(0, 40)}</span>
              </div>
            ))}
          </div>
        )}

        {loading && !streaming && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-3 bg-hover-bg flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {/* AI 建议的待确认操作 */}
        {pendingAction && (
          <ConfirmableActionCard
            action={pendingAction}
            busy={actionBusy}
            onConfirm={() => confirmPendingAction(pendingAction)}
            onCancel={() => setPendingAction(null)}
          />
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border-soft p-2.5 bg-toolbar/60">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={agentMode ? '让 AI 分析或修改这篇笔记（修改需你确认）' : '基于本篇笔记提问'}
            className="flex-1 resize-none px-3 py-2 max-h-28 bg-content rounded-xl border border-border-soft outline-none text-sm focus:border-brand/40 transition-colors"
            disabled={loading}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="btn btn-primary h-9 px-4 shrink-0 disabled:opacity-40"
          >
            发送
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between pl-1">
          <span className="text-[10px] text-fg-faint">*Enter 发送 / Shift+Enter 换行</span>
          <button
            onClick={() => setAgentMode((v) => !v)}
            disabled={loading}
            title="智能体模式下 AI 可主动调用知识库工具，涉及修改会先给出建议并等待你确认"
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors inline-flex items-center gap-1 disabled:opacity-50 ${
              agentMode
                ? 'border-brand/40 text-brand bg-brand-soft/30'
                : 'border-border-soft text-fg-secondary hover:bg-hover-bg'
            }`}
          >
            <Icon name="sparkles" className="w-3 h-3" />
            智能体
          </button>
        </div>
      </div>
    </div>
  );
}
