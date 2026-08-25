import { useState } from 'react';
import { Icon } from './Icon';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

interface Props {
  kbId: string;
  notePath: string;
  onAppend?: (text: string) => void;
}

/**
 * 围绕当前笔记的 AI 聊天面板。
 * 上下文由主进程 askAboutNote 注入（读取该篇笔记内容）。
 * 每条 AI 回复提供「追加到该笔记」入口：AI 结合回复与现有笔记全文重写完善。
 */
export function NoteAIChat({ kbId, notePath, onAppend }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!kbId || !input.trim()) return;
    const q = input.trim();
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    try {
      const ans = await window.forge.ai.askAboutNote(kbId, notePath, q);
      setMessages((m) => [...m, { role: 'ai', text: ans || '（无回答）' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'ai', text: '出错了：' + String(e) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <div className="text-fg-faint text-center py-8 text-xs">
            已将该笔记作为上下文。<br />向 AI 提问以延展、总结或完善这篇笔记。
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="max-w-[88%]">
            <div
              className={`rounded px-3 py-2 whitespace-pre-wrap ${
                m.role === 'user' ? 'ml-auto bg-brand text-brand-fg' : 'bg-hover-bg text-fg'
              }`}
            >
              {m.text}
            </div>
            {m.role === 'ai' && (
              <div className="flex gap-2 mt-1.5 pl-1">
                <button
                  onClick={() => onAppend?.(m.text)}
                  className="text-[11px] px-2 py-1 rounded border border-border-soft text-fg-secondary hover:bg-hover-bg hover:text-fg"
                  title="AI 将结合此回复与现有笔记内容、格式，重新完善整篇文章"
                >
                  <Icon name="plus" className="w-3 h-3 inline mr-0.5" />
                  追加到该笔记
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && <div className="text-fg-faint text-xs">思考中…</div>}
      </div>
      <div className="border-t border-border-soft p-2 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="基于本篇笔记提问…"
          className="flex-1 px-3 py-1.5 bg-transparent outline-none text-sm"
          disabled={loading}
        />
        <button onClick={send} disabled={loading || !input.trim()} className="btn btn-primary">
          发送
        </button>
      </div>
    </div>
  );
}
