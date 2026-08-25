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

// 大纲与正文双向同步用的事件名
export const EVT_JUMP_HEADING = 'forgenote:jump-heading'; // detail: 行号
export const EVT_ACTIVE_HEADING = 'forgenote:active-heading'; // detail: 行号

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
    mtime: number;
    ctime: number;
    frontmatter: Record<string, unknown>;
  }) => void;
}

export function NotePane(props: Props) {
  const { activeKb, pushToast } = useKBStore();
  const { markTabDirty } = useLayoutStore();
  const [note, setNote] = useState<{ content: string; outlinks: string[]; inlinks: string[]; brokenLinks: string[]; mtime: number; ctime: number; frontmatter: Record<string, unknown> } | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview' | 'split'>('split');
  // 实时内容：编辑器每次变更都会更新，用于分屏实时预览（不依赖写盘）
  const [liveContent, setLiveContent] = useState('');
  // 编辑器仅在切换笔记时重建：记录已加载完成的路径，作为初始化 effect 的唯一依赖
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!activeKb) return;
    let cancelled = false;
    // 切换标签时先把内容清空，避免显示上一个文件的内容
    setNote(null);
    setLiveContent('');
    (async () => {
      try {
        const c = await window.forge.fs.readNote(activeKb.id, props.notePath);
        if (cancelled) return;
        const info = {
          content: c.content,
          outlinks: c.outlinks,
          inlinks: c.inlinks,
          brokenLinks: c.brokenLinks,
          mtime: c.mtime,
          ctime: c.ctime,
          frontmatter: c.frontmatter
        };
        setNote(info);
        setLiveContent(c.content);
        setLoadedPath(props.notePath);
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

  // 初始化 CodeMirror（仅在切换笔记 loadedPath 变化时重建，自动保存不再触发重建）
  useEffect(() => {
    if (!containerRef.current || !note || loadedPath !== props.notePath) return;
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
            setLiveContent(v.state.doc.toString()); // 实时预览同步
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
                  brokenLinks: c.brokenLinks,
                  mtime: c.mtime,
                  ctime: c.ctime,
                  frontmatter: c.frontmatter
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
  }, [loadedPath]);

  // 实时预览 HTML（基于 liveContent，分屏编辑即时同步）
  const [previewHtml, setPreviewHtml] = useState('');
  useEffect(() => {
    const html = renderMarkdownPreview(liveContent, activeKb?.id || '', props.notePath);
    setPreviewHtml(html);
  }, [liveContent, activeKb?.id, props.notePath]);

  // 大纲点击跳转：滚动到对应标题
  useEffect(() => {
    const onJump = (e: Event) => {
      const line = (e as CustomEvent<number>).detail;
      if (!line) return;
      const el = previewRef.current?.querySelector<HTMLElement>(`[data-line="${line}"]`);
      if (el && previewRef.current) {
        previewRef.current.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
        return;
      }
      // 编辑模式下：用 CodeMirror 定位到行
      const view = viewRef.current;
      if (view) {
        const target = Math.max(0, line - 1);
        const pos = view.state.doc.line(Math.min(target + 1, view.state.doc.lines)).from;
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      }
    };
    window.addEventListener(EVT_JUMP_HEADING, onJump);
    return () => window.removeEventListener(EVT_JUMP_HEADING, onJump);
  }, []);

  // 滚动时计算当前可见标题，派发 active-heading 事件（大纲高亮双向同步）
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = () => {
    if (activeTimer.current) clearTimeout(activeTimer.current);
    activeTimer.current = setTimeout(() => {
      const scrollEl = previewRef.current;
      if (!scrollEl) return;
      const headings = Array.from(
        scrollEl.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
      );
      if (headings.length === 0) return;
      const top = scrollEl.scrollTop + 24;
      let current = headings[0];
      for (const h of headings) {
        if (h.offsetTop <= top) current = h;
        else break;
      }
      const line = Number(current.getAttribute('data-line'));
      if (line) window.dispatchEvent(new CustomEvent(EVT_ACTIVE_HEADING, { detail: line }));
    }, 80);
  };

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
        {/* 编辑器容器始终挂载（仅用 hidden 控制显隐），避免预览切回时空白 */}
        <div
          ref={containerRef}
          className={`h-full overflow-auto ${tab === 'split' ? 'w-1/2 border-r border-border' : 'w-full'} ${tab === 'preview' ? 'hidden' : ''}`}
        />
        {(tab === 'preview' || tab === 'split') && (
          <div
            ref={previewRef}
            onScroll={handleScroll}
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
