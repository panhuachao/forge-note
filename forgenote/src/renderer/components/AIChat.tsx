import { useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';

interface Props {
  mode: 'ask' | 'search';
}

export function AIChat({ mode }: Props) {
  const { activeKb, pushToast } = useKBStore();
  const { openTab, setMainView } = useLayoutStore();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!activeKb || !input.trim()) return;
    const q = input.trim();
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    try {
      if (mode === 'ask') {
        const ans = await window.forge.ai.ask(activeKb.id, q);
        setMessages((m) => [...m, { role: 'ai', text: ans || '（无回答）' }]);
      } else {
        const r = await window.forge.search.query(activeKb.id, q, { limit: 20 });
        if (r.length === 0) {
          setMessages((m) => [...m, { role: 'ai', text: '未检索到相关笔记。' }]);
        } else {
          setMessages((m) => [
            ...m,
            {
              role: 'ai',
              text:
                '检索到 ' +
                r.length +
                ' 条结果：\n' +
                r.map((x) => `- ${x.noteName.replace(/\.md$/i, '')} — ${x.snippet.slice(0, 60)}`).join('\n')
            }
          ]);
        }
      }
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-80">
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {messages.length === 0 && (
          <div className="text-ink-400 text-center py-8">
            {mode === 'ask' ? '向你的知识库提问…' : '在所有笔记中检索关键词…'}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[80%] rounded px-3 py-2 whitespace-pre-wrap ${
              m.role === 'user' ? 'ml-auto bg-brand-600 text-white' : 'bg-ink-100 text-ink-800'
            }`}
          >
            {m.text}
          </div>
        ))}
        {loading && <div className="text-ink-400 text-xs">思考中…</div>}
      </div>
      <div className="border-t border-ink-200 p-2 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={mode === 'ask' ? '向知识库提问…' : '搜索关键词…'}
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
