// 单个笔记标签页的内容：编辑器 + 预览
// AI 操作已移至 TopToolbar（顶部工具条）
import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from './Icon';
import { renderMarkdownPreview } from '../utils/markdown-preview';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

interface Props {
  notePath: string;
  onOpenNote: (path: string) => void;
  onContentChange?: (info: {
    content: string;
    outlinks: string[];
    inlinks: string[];
    brokenLinks: string[];
  }) => void;
}

export function NotePane(props: Props) {
  const { activeKb, pushToast } = useKBStore();
  const { markTabDirty } = useLayoutStore();
  const [note, setNote] = useState<{ content: string; outlinks: string[]; inlinks: string[]; brokenLinks: string[] } | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview' | 'split'>('split');
  const [previewHtml, setPreviewHtml] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!activeKb) return;
    let cancelled = false;
    // 切换标签时先把内容清空，避免显示上一个文件的内容
    setNote(null);
    (async () => {
      try {
        const c = await window.forge.fs.readNote(activeKb.id, props.notePath);
        if (cancelled) return;
        const info = {
          content: c.content,
          outlinks: c.outlinks,
          inlinks: c.inlinks,
          brokenLinks: c.brokenLinks
        };
        setNote(info);
        props.onContentChange?.(info);
      } catch (e) {
        if (cancelled) return;
        pushToast({ level: 'error', text: '打开笔记失败：' + String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeKb?.id, props.notePath]);

  useEffect(() => {
    if (!containerRef.current || !note) return;
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
    const state = EditorState.create({
      doc: note.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((v) => {
          if (v.docChanged) {
            markTabDirty(props.notePath, true);
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => {
              if (activeKb && note) {
                const newContent = v.state.doc.toString();
                await window.forge.fs.writeNote(activeKb.id, props.notePath, newContent);
                markTabDirty(props.notePath, false);
                const c = await window.forge.fs.readNote(activeKb.id, props.notePath);
                const info = {
                  content: c.content,
                  outlinks: c.outlinks,
                  inlinks: c.inlinks,
                  brokenLinks: c.brokenLinks
                };
                setNote(info);
                props.onContentChange?.(info);
              }
            }, 500);
          }
        })
      ]
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.content, props.notePath]);

  useEffect(() => {
    if (!note) return;
    const html = renderMarkdownPreview(note.content, activeKb?.id || '', props.notePath);
    setPreviewHtml(html);
  }, [note?.content, activeKb?.id, props.notePath]);

  if (!note) {
    return <div className="flex-1 flex items-center justify-center text-ink-400">加载中…</div>;
  }

  const fileName = props.notePath.split('/').pop()?.replace(/\.md$/i, '') || '';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* 标题栏 - 仅显示文件信息 + 视图切换 */}
      <div className="h-8 flex items-center px-3 border-b border-ink-200 gap-2 text-xs bg-ink-50">
        <Icon name="document" className="w-4 h-4 text-ink-400" />
        <span className="font-medium truncate">{fileName}</span>
        <span className="text-ink-400 truncate flex-1">{props.notePath}</span>
        <button onClick={() => setTab('edit')} className={`px-2 h-6 rounded ${tab === 'edit' ? 'bg-white text-ink-900' : 'text-ink-600 hover:bg-white/50'}`}>编辑</button>
        <button onClick={() => setTab('split')} className={`px-2 h-6 rounded ${tab === 'split' ? 'bg-white text-ink-900' : 'text-ink-600 hover:bg-white/50'}`}>分屏</button>
        <button onClick={() => setTab('preview')} className={`px-2 h-6 rounded ${tab === 'preview' ? 'bg-white text-ink-900' : 'text-ink-600 hover:bg-white/50'}`}>预览</button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {(tab === 'edit' || tab === 'split') && (
          <div
            ref={containerRef}
            className={`h-full overflow-auto ${tab === 'split' ? 'w-1/2 border-r border-ink-200' : 'w-full'}`}
          />
        )}
        {(tab === 'preview' || tab === 'split') && (
          <div
            className={`h-full overflow-auto bg-white p-6 ${tab === 'split' ? 'w-1/2' : 'w-full'}`}
          >
            <article
              className="markdown-preview max-w-3xl mx-auto"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
