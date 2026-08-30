import { useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { hubText, type HubRequest } from '../utils/ai-hub';
import { useKBStore } from '../stores/kb-store';
import { Icon } from './Icon';

export type InlineMode = 'rewrite' | 'continue' | 'translate';

interface Props {
  view: EditorView;
  onClose: () => void;
}

interface SelectionInfo {
  from: number;
  to: number;
  menuX: number;
  menuY: number;
}

const MODE_LABEL: Record<InlineMode, string> = {
  rewrite: '改写',
  continue: '续写',
  translate: '翻译'
};

const DEFAULT_INSTRUCTION: Record<InlineMode, string> = {
  rewrite: '请改写下面这段内容，使其更通顺、精炼、专业，保留原意与 Markdown 格式。',
  continue: '请基于下面这段内容的语气与主题，自然地续写一段连贯的文字，不要重复已有内容。',
  translate: '请将下面这段内容翻译为中文，保留原有 Markdown 格式，技术术语可保留英文原词。'
};

/**
 * 编辑器内联 AI：右键菜单 + 要求弹窗 + 复制结果。
 * 流程：选中文字 → 右键选择改写/续写/翻译 → 弹窗显示已选文本与可编辑要求 → 确认 → AI 生成 → 弹窗内展示结果 → 用户复制后自行粘贴修改。
 */
export function InlineEditToolbar({ view, onClose }: Props) {
  const activeKb = useKBStore((s) => s.activeKb);
  const currentNote = useKBStore((s) => s.currentNote);
  const pushToast = useKBStore((s) => s.pushToast);
  const kbId = activeKb?.id;
  const notePath = currentNote?.content.path;

  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const [mode, setMode] = useState<InlineMode | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultSectionRef = useRef<HTMLDivElement>(null);

  // 监听 CodeMirror 右键菜单事件：有选区时显示自定义菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const s = view.state.selection.main;
      const hasSel = s.from !== s.to && s.to - s.from <= 2000;
      if (!hasSel) return;
      // 仅当点击发生在编辑器内容区才拦截默认右键菜单
      const target = e.target as HTMLElement;
      if (!view.dom.contains(target)) return;
      e.preventDefault();
      setSel({ from: s.from, to: s.to, menuX: e.clientX, menuY: e.clientY });
      setMode(null);
      setResult(null);
      setError(null);
    };
    view.dom.addEventListener('contextmenu', handler);
    return () => view.dom.removeEventListener('contextmenu', handler);
  }, [view]);

  useEffect(() => {
    if (mode) {
      setInstruction(DEFAULT_INSTRUCTION[mode]);
      setResult(null);
      setError(null);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [mode]);

  useEffect(() => {
    if (result != null && resultSectionRef.current) {
      resultSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [result]);

  const closeAll = () => {
    setSel(null);
    setMode(null);
    setResult(null);
    setError(null);
    setInstruction('');
    onClose();
  };

  const run = async () => {
    if (!kbId) {
      pushToast({ level: 'warn', text: '请先打开一个知识库' });
      return;
    }
    if (!sel || !mode) return;
    const text = view.state.sliceDoc(sel.from, sel.to).trim();
    const promptText = mode === 'continue' ? view.state.sliceDoc(Math.max(0, sel.from - 400), sel.to) : text;
    if (!promptText) {
      setError('未选中任何文本');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await hubText({
        skill: 'inline-edit',
        input: { mode, text: promptText, instruction, notePath },
        kbId
      } as HubRequest);
      setResult(String(out ?? '').trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      pushToast({ level: 'success', text: '已复制到剪贴板' });
    } catch {
      pushToast({ level: 'error', text: '复制失败，请手动复制' });
    }
  };

  const selectedText = sel ? view.state.sliceDoc(sel.from, sel.to).trim() : '';

  return (
    <>
      {/* 右键菜单 */}
      {sel && !mode && (
        <>
          <div className="inline-edit-backdrop" onMouseDown={() => closeAll()} />
          <div
            className="inline-edit-menu"
            style={{ left: sel.menuX, top: sel.menuY }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {(['rewrite', 'continue', 'translate'] as InlineMode[]).map((m) => (
              <button key={m} className="inline-edit-menu-item" onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 要求弹窗 */}
      {mode && (
        <div className="inline-edit-modal-backdrop" onMouseDown={() => closeAll()}>
          <div
            className="inline-edit-modal"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="inline-edit-modal-header">
              <span className="inline-edit-modal-title">{MODE_LABEL[mode]}</span>
              <button className="inline-edit-close" onClick={closeAll} title="关闭">
                <Icon name="x-mark" className="w-4 h-4" solid />
              </button>
            </div>

            <div className="inline-edit-modal-body">
              <div className="inline-edit-section">
                <label className="inline-edit-label">已选文本</label>
                <pre className="inline-edit-preview">{selectedText}</pre>
              </div>

              <label className="inline-edit-label">要求（可编辑）</label>
              <textarea
                ref={textareaRef}
                className="inline-edit-textarea"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={4}
                disabled={busy || result != null}
              />

              {busy && <div className="inline-edit-loading">AI 处理中…</div>}
              {!busy && error && <div className="inline-edit-error">{error}</div>}
              {!busy && result != null && (
                <div ref={resultSectionRef} className="inline-edit-section">
                  <label className="inline-edit-label">AI 结果（可复制后自行粘贴修改）</label>
                  {result ? (
                    <pre className="inline-edit-result">{result}</pre>
                  ) : (
                    <div className="inline-edit-error">AI 未返回有效内容，请重试。</div>
                  )}
                </div>
              )}
            </div>

            <div className="inline-edit-modal-footer">
              {result == null ? (
                <>
                  <button className="btn" onClick={closeAll} disabled={busy}>
                    取消
                  </button>
                  <button className="btn btn-primary" onClick={run} disabled={busy || !instruction.trim()}>
                    确认
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={copyResult} disabled={!result}>
                    复制
                  </button>
                  <button className="btn" onClick={closeAll}>
                    关闭
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
