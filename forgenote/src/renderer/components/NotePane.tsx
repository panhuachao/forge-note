// 单个笔记标签页的内容：编辑器 + 预览
// AI 操作已移至 TopToolbar（顶部工具条）
import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from './Icon';
import { renderMarkdownPreview } from '../utils/markdown-preview';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Markdown 语法高亮：使用中性色，避免默认把 `>`(引用) 等染成红色。
// 颜色走 CSS 变量，亮色/暗黑自动适配。
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, color: 'rgb(var(--c-brand))', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700', color: 'rgb(var(--c-text))' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'rgb(var(--c-text-secondary))' },
  { tag: t.link, color: 'rgb(var(--c-brand))', textDecoration: 'underline' },
  { tag: t.url, color: 'rgb(var(--c-text-muted))' },
  { tag: t.quote, color: 'rgb(var(--c-text-faint))' },
  { tag: t.monospace, color: 'rgb(var(--c-text-secondary))' },
  { tag: t.list, color: 'rgb(var(--c-text-muted))' },
  { tag: t.contentSeparator, color: 'rgb(var(--c-text-faint))' },
  { tag: [t.processingInstruction, t.meta], color: 'rgb(var(--c-text-faint))' },
  { tag: t.keyword, color: 'rgb(var(--c-text-muted))' },
  { tag: t.comment, color: 'rgb(var(--c-text-faint))' },
  { tag: t.atom, color: 'rgb(var(--c-text-secondary))' },
]);

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
        syntaxHighlighting(markdownHighlight),
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
    return <div className="flex-1 flex items-center justify-center text-fg-muted">加载中…</div>;
  }

  const fileName = props.notePath.split('/').pop()?.replace(/\.md$/i, '') || '';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-content">
      {/* 标题栏 - 仅显示文件信息 + 视图切换 */}
      <div className="h-10 flex items-center px-3 border-b border-border-soft gap-2 text-xs bg-content">
        <Icon name="document" className="w-4 h-4 text-fg-faint" />
        <span className="font-medium truncate text-fg">{fileName}</span>
        <span className="text-fg-muted truncate flex-1 text-[11px]">{props.notePath}</span>
        {/* 编辑/分屏/预览 分段控件（浅灰底容器 + 浅灰高亮选中） */}
        <div className="flex items-center h-7 bg-panel rounded-md p-0.5 shrink-0 border border-border-soft">
          <button onClick={() => setTab('edit')} className={`h-6 px-3 rounded text-[12px] transition-colors ${tab === 'edit' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}>编辑</button>
          <button onClick={() => setTab('split')} className={`h-6 px-3 rounded text-[12px] transition-colors ${tab === 'split' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}>分屏</button>
          <button onClick={() => setTab('preview')} className={`h-6 px-3 rounded text-[12px] transition-colors ${tab === 'preview' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}>预览</button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {(tab === 'edit' || tab === 'split') && (
          <div
            ref={containerRef}
            className={`h-full overflow-auto ${tab === 'split' ? 'w-1/2 border-r border-border' : 'w-full'}`}
          />
        )}
        {(tab === 'preview' || tab === 'split') && (
          <div
            className={`h-full overflow-auto bg-content p-6 ${tab === 'split' ? 'w-1/2' : 'w-full'}`}
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
