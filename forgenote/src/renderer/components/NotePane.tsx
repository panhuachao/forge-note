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
// AI 聊天面板「追加到该笔记」：用 AI 回复完善整篇笔记
export const EVT_APPEND_NOTE = 'forgenote:append-note'; // detail: { text: string }

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
  // 分屏滚动同步：防止两侧滚动事件互相触发形成回环
  const syncingRef = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 监听「AI 聊天面板追加回复到笔记」事件：调用 AI 结合回复与现有笔记全文，
  // 重写完善整篇笔记后整体替换文档，触发 docChanged → 自动保存。
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      const view = viewRef.current;
      if (!view || !detail?.text || !activeKb) return;
      const reply = detail.text.trim();
      if (!reply) return;
      pushToast({ level: 'info', text: 'AI 正在完善笔记…' });
      try {
        const current = view.state.doc.toString();
        const refined = await window.forge.ai.refineNote(activeKb.id, props.notePath, reply, current);
        if (!refined) {
          pushToast({ level: 'error', text: '完善失败：返回为空' });
          return;
        }
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: refined },
          selection: { anchor: refined.length }
        });
        pushToast({ level: 'success', text: '已完善并写入笔记' });
      } catch (err) {
        pushToast({ level: 'error', text: '完善失败：' + String(err) });
      }
    };
    window.addEventListener(EVT_APPEND_NOTE, handler);
    return () => window.removeEventListener(EVT_APPEND_NOTE, handler);
  }, [pushToast, activeKb, props.notePath]);

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
    // 编辑器滚动 → 按百分比同步到预览（原文与渲染高度不成比例，用比例最稳健）
    const edScroller = view.scrollDOM;
    const onEditorScroll = () => {
      if (syncingRef.current) return;
      const pv = previewRef.current;
      if (!pv) return;
      const edDenom = edScroller.scrollHeight - edScroller.clientHeight;
      const ratio = edDenom > 0 ? edScroller.scrollTop / edDenom : 0;
      const pvDenom = pv.scrollHeight - pv.clientHeight;
      syncingRef.current = true;
      pv.scrollTop = ratio * pvDenom;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        syncingRef.current = false;
      }, 80);
    };
    edScroller.addEventListener('scroll', onEditorScroll);
    return () => {
      edScroller.removeEventListener('scroll', onEditorScroll);
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

  // 滚动时：预览 → 按百分比同步到编辑器，并计算当前可见标题派发 active-heading
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = () => {
    // 程序触发的同步滚动：不回写，避免回环
    if (syncingRef.current) return;
    const pv = previewRef.current;
    const ed = viewRef.current?.scrollDOM;
    if (pv && ed) {
      const pvDenom = pv.scrollHeight - pv.clientHeight;
      const ratio = pvDenom > 0 ? pv.scrollTop / pvDenom : 0;
      const edDenom = ed.scrollHeight - ed.clientHeight;
      syncingRef.current = true;
      ed.scrollTop = ratio * edDenom;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        syncingRef.current = false;
      }, 80);
    }
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
      {/* 标题栏 - 文件名 + 视图切换（居中胶囊）。磨砂半透明、去硬边框、轻投影 */}
      <div className="h-12 flex items-center px-4 gap-3 text-xs bg-toolbar/70 backdrop-blur-sm shadow-[0_1px_0_var(--border-soft)] relative z-10">
        <Icon name="document" className="w-4 h-4 text-fg-faint shrink-0" />
        <span className="font-medium truncate text-fg max-w-[40%]">{fileName}</span>
        <div className="flex-1" />
        {/* 编辑/分屏/预览 分段控件（选中态品牌色填充） */}
        <div className="flex items-center h-8 bg-panel/70 rounded-full p-1 shrink-0">
          <button
            onClick={() => setTab('edit')}
            className={`h-6 px-4 rounded-full text-[12px] transition-all ${tab === 'edit' ? 'bg-brand text-brand-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}
          >编辑</button>
          <button
            onClick={() => setTab('split')}
            className={`h-6 px-4 rounded-full text-[12px] transition-all ${tab === 'split' ? 'bg-brand text-brand-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}
          >分屏</button>
          <button
            onClick={() => setTab('preview')}
            className={`h-6 px-4 rounded-full text-[12px] transition-all ${tab === 'preview' ? 'bg-brand text-brand-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}
          >预览</button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 编辑器容器始终挂载（仅用 hidden 控制显隐），避免预览切回时空白 */}
        <div
          ref={containerRef}
          className={`h-full overflow-auto ${tab === 'split' ? 'w-1/2 pane-split-divider' : 'w-full'} ${tab === 'preview' ? 'hidden' : ''}`}
        />
        {(tab === 'preview' || tab === 'split') && (
          <div
            ref={previewRef}
            onScroll={handleScroll}
            className={`h-full overflow-auto bg-content p-8 ${tab === 'split' ? 'w-1/2' : 'w-full'}`}
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
