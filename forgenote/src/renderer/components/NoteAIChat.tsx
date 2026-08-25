import { useState, useRef, useEffect } from 'react';
import { Icon } from './Icon';
import { renderMarkdownPreview } from '../utils/markdown-preview';

interface Message {
  role: 'user' | 'ai';
  text: string;
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
 * 上下文由主进程 askAboutNote 注入（读取该篇笔记内容）。
 * 每条 AI 回复提供「追加到该笔记」入口：AI 结合回复与现有笔记全文重写完善。
 */
export function NoteAIChat({ kbId, notePath, onAppend }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!kbId || !question || loading) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      const ans = await window.forge.ai.askAboutNote(kbId, notePath, question);
      setMessages((m) => [...m, { role: 'ai', text: ans || '（无回答）' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'ai', text: '出错了：' + String(e) }]);
    } finally {
      setLoading(false);
    }
  }

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
              {m.role === 'ai' && (
                <div className="flex gap-2 mt-1.5 pl-1">
                  <button
                    onClick={() => copy(m.text, i)}
                    className="text-[11px] px-2 py-1 rounded-md text-fg-secondary hover:bg-hover-bg hover:text-fg transition-colors inline-flex items-center gap-1"
                    title="复制回答"
                  >
                    <Icon name={copiedId === i ? 'check-circle' : 'copy'} className="w-3.5 h-3.5" />
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

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-3 bg-hover-bg flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
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
            placeholder="基于本篇笔记提问"
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
        <div className="mt-1.5 text-[10px] text-fg-faint pl-1">
          *Enter 发送 / Shift+Enter 换行
        </div>
      </div>
    </div>
  );
}
