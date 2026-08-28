// 单个笔记标签页的内容：编辑器 + 预览
// AI 操作已移至 TopToolbar（顶部工具条）
import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { useKBStore, requireAI } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from './Icon';
import { ConfirmableActionCard } from './ConfirmableActionCard';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import { hubConfirm, hubRun } from '../utils/ai-hub';
import type { ConfirmableAction } from '@shared/types/ai';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// 大纲与正文双向同步用的事件名
export const EVT_JUMP_HEADING = 'forgenote:jump-heading'; // detail: 行号
export const EVT_ACTIVE_HEADING = 'forgenote:active-heading'; // detail: 行号
// AI 聊天面板「追加到该笔记」：用 AI 回复完善整篇笔记
export const EVT_APPEND_NOTE = 'forgenote:append-note'; // detail: { text: string }
// 在光标处插入文本（如语音转写链接）
export const EVT_INSERT_TEXT = 'forgenote:insert-text'; // detail: string

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
  const [tab, setTab] = useState<'edit' | 'preview' | 'split'>('preview');
  // 实时内容：编辑器每次变更都会更新，用于分屏实时预览（不依赖写盘）
  const [liveContent, setLiveContent] = useState('');
  // 编辑器仅在切换笔记时重建：记录已加载完成的路径，作为初始化 effect 的唯一依赖
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 最近一次由「本编辑器自己」写盘的内容：用于区分自己的自动保存与真正的外部/AI 修改。
  // 若不加区分，自动保存产生的 fs:change 会反过来触发文档全量覆盖，光标被弹回开头。
  const lastSelfWriteRef = useRef<string | null>(null);
  // 最近一次确认已落盘的笔记内容：用于判断用户此刻是否有未保存的编辑输入
  const lastDiskContentRef = useRef<string | null>(null);
  // 分屏滚动同步：防止两侧滚动事件互相触发形成回环
  const syncingRef = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 待确认的 AI 润色操作（Confirm-then-Act：先出 diff 预览，用户确认才写盘）
  const [pendingAction, setPendingAction] = useState<ConfirmableAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // 事件监听器内需要读到最新 action，用 ref 避免频繁重建监听
  const pendingRef = useRef<ConfirmableAction | null>(null);

  // 监听「AI 聊天面板追加回复到笔记」事件：调用 AI 结合回复与现有笔记全文，
  // 重写完善整篇笔记后整体替换文档，触发 docChanged → 自动保存。
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      const view = viewRef.current;
      if (!view || !detail?.text || !activeKb) return;
      if (!requireAI()) return;
      const reply = detail.text.trim();
      if (!reply) return;
      pushToast({ level: 'info', text: 'AI 正在完善笔记…' });
      try {
        // 先把编辑器内容落盘：服务端 Patch 以磁盘内容为基线，
        // 既保证「预览所见」==「实际所改」，也避免丢失未保存编辑。
        const flushed = view.state.doc.toString();
        lastSelfWriteRef.current = flushed;
        lastDiskContentRef.current = flushed;
        await window.forge.fs.writeNote(activeKb.id, props.notePath, flushed);
        const res = await hubRun({
          skill: 'refine-note',
          input: { text: reply, notePath: props.notePath },
          kbId: activeKb.id
        });
        // 产出待确认建议：渲染确认卡片，用户确认后才写盘
        if (res.kind === 'structured' && res.pending && res.data) {
          const action = res.data as ConfirmableAction;
          pendingRef.current = action;
          setPendingAction(action);
          return;
        }
        pushToast({ level: 'info', text: res.kind === 'text' ? res.text : 'AI 未产出修改' });
      } catch (err) {
        pushToast({ level: 'error', text: '完善失败：' + String(err) });
      }
    };
    window.addEventListener(EVT_APPEND_NOTE, handler);
    // 光标处插入文本（语音转写链接等）
    const insertHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail !== 'string' || !detail) return;
      const view = viewRef.current;
      if (!view) return;
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, insert: detail },
        selection: { anchor: pos + detail.length }
      });
    };
    window.addEventListener(EVT_INSERT_TEXT, insertHandler);
    return () => {
      window.removeEventListener(EVT_APPEND_NOTE, handler);
      window.removeEventListener(EVT_INSERT_TEXT, insertHandler);
    };
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
        lastDiskContentRef.current = c.content;
        lastSelfWriteRef.current = null;
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

  // AI / 外部修改笔记后，实时刷新当前笔记的编辑区与预览区（doc/MCP技术实现方案.md）
  useEffect(() => {
    if (!activeKb) return;
    const off = window.forge.events.onFsChange((e) => {
      if (e.type !== 'change' || e.path !== props.notePath) return;
      void (async () => {
        try {
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
          const view = viewRef.current;
          const currentDoc = view ? view.state.doc.toString() : null;
          // 用户此刻是否有尚未落盘的输入（据此判断能否安全覆盖文档）
          const hasUnsavedEdit =
            currentDoc !== null && lastDiskContentRef.current !== null && currentDoc !== lastDiskContentRef.current;

          // 先更新元数据与预览（不影响编辑器文档，因此不会打断输入）
          setNote(info);
          setLiveContent(c.content);
          setLoadedPath(props.notePath);
          props.onContentChange?.(info);

          // ① 自己的自动保存回环：磁盘内容就是自己刚写的那份，
          //    只读回元信息即可，绝不能反过来覆盖编辑器（否则光标被弹回开头、输入被回滚）。
          if (lastSelfWriteRef.current !== null && lastSelfWriteRef.current === c.content) {
            lastSelfWriteRef.current = null;
            lastDiskContentRef.current = c.content;
            return;
          }
          lastSelfWriteRef.current = null;

          if (!view || currentDoc === null) return;
          if (currentDoc === c.content) {
            lastDiskContentRef.current = c.content;
            return;
          }

          // ② 用户有未保存的编辑 → 不覆盖文档，避免打断输入、丢失刚敲进去的内容。
          //    外部/AI 的修改会在用户下次自动保存后随事件再次到达，届时再同步。
          if (hasUnsavedEdit) return;

          // ③ 真正的外部修改（AI 改笔记 / 其它窗口编辑）：替换文档，但保留光标位置。
          //    这里不能把 selection 硬编码为 0，否则光标会跳到第一行。
          lastDiskContentRef.current = c.content;
          const anchor = Math.min(view.state.selection.main.anchor, c.content.length);
          const head = Math.min(view.state.selection.main.head, c.content.length);
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: c.content },
            selection: { anchor, head }
          });
        } catch (e) {
          pushToast({ level: 'error', text: '刷新笔记失败：' + String(e) });
        }
      })();
    });
    return off;
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
        EditorView.domEventHandlers({
          paste: (event, view) => {
            const kb = activeKb;
            const notePath = props.notePath;
            if (!kb || !notePath) return false;
            const dt = (event as ClipboardEvent).clipboardData;
            const items = dt?.items ? (Array.from(dt.items) as DataTransferItem[]) : [];
            const imgItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
            if (!imgItem) return false;
            event.preventDefault();
            const blob = imgItem.getAsFile();
            if (!blob) return true;
            void (async () => {
              try {
                const buf = new Uint8Array(await blob.arrayBuffer());
                const ext = (imgItem.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
                const rel = await window.forge.media.saveImage(kb.id, buf, ext);
                const insert = `![图片](${rel})\n`;
                const pos = view.state.selection.main.head;
                view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
                pushToast({ level: 'success', text: '图片已保存到 .assets' });
              } catch (e) {
                pushToast({ level: 'error', text: '图片保存失败：' + String(e) });
              }
            })();
            return true;
          }
        }),
        EditorView.updateListener.of((v) => {
          if (v.docChanged) {
            markTabDirty(props.notePath, true);
            setLiveContent(v.state.doc.toString()); // 实时预览同步
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => {
              if (activeKb && note) {
                const newContent = v.state.doc.toString();
                // 标记这次写盘是自己发起的：随后到达的 fs:change 据此跳过文档覆盖，
                // 避免「自动保存 → 文件变更事件 → 回读覆盖编辑器」把光标弹回开头。
                lastSelfWriteRef.current = newContent;
                lastDiskContentRef.current = newContent;
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

  // 预览区任务项点击：切换 [ ]/[x]/[~]/[-] 状态并写回编辑器（→ 自动保存 + 实时预览刷新）
  const onTaskToggle = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.task-toggle');
    if (!target) return;
    const wrap = target.closest('.task-list-item') as HTMLElement | null;
    if (!wrap) return;
    const line = Number(wrap.getAttribute('data-line'));
    const view = viewRef.current;
    if (!view || !line || !activeKb) return;
    // 状态循环：待办 → 进行中 → 已完成 → 取消 → 待办
    const order = ['todo', 'doing', 'done', 'cancel'] as const;
    const cur = (target.getAttribute('data-state') as (typeof order)[number]) || 'todo';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    const mark = next === 'done' ? 'x' : next === 'doing' ? '~' : next === 'cancel' ? '-' : ' ';
    const ln = Math.min(Math.max(line, 1), view.state.doc.lines);
    const lineObj = view.state.doc.line(ln);
    const replaced = lineObj.text.replace(/^(\s*(?:[-*+]|\d+\.)\s*\[)[ xX~\-](\]\s+)/, `$1${mark}$2`);
    if (replaced === lineObj.text) return; // 该行不是任务项，避免误改
    view.dispatch({
      changes: { from: lineObj.from, to: lineObj.to, insert: replaced },
      selection: { anchor: lineObj.from }
    });
  };

  // 编辑/分屏/预览切换时容器尺寸或显隐发生变化，CodeMirror 不会自动重排，
  // 需手动触发重新测量，否则分屏/切回时左侧原文区会空白或错位。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const id = requestAnimationFrame(() => view.requestMeasure());
    return () => cancelAnimationFrame(id);
  }, [tab]);

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

  /** 用户确认 AI 润色建议：执行预览过的 Patch，再把结果同步回编辑器 */
  async function confirmPending() {
    const action = pendingRef.current;
    const kbId = activeKb?.id;
    if (!kbId || !action) return;
    setActionBusy(true);
    try {
      const res = await hubConfirm(
        { skill: 'refine-note', input: { text: '', notePath: props.notePath }, kbId },
        action
      );
      pendingRef.current = null;
      setPendingAction(null);
      // 重新读盘并把新内容同步回编辑器（光标保持在合法范围内）
      const fresh = await window.forge.fs.readNote(kbId, props.notePath);
      const view = viewRef.current;
      if (view) {
        const pos = Math.min(view.state.selection.main.head, fresh.content.length);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: fresh.content },
          selection: { anchor: pos }
        });
      }
      pushToast({ level: 'success', text: res.kind === 'text' ? res.text : '已完善并写入笔记' });
    } catch (e) {
      pushToast({ level: 'error', text: '应用失败：' + String(e) });
    } finally {
      setActionBusy(false);
    }
  }

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
            onClick={onTaskToggle}
            className={`h-full overflow-auto bg-content p-8 ${tab === 'split' ? 'w-1/2' : 'w-full'}`}
          >
            <article
              className="markdown-preview max-w-3xl mx-auto"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </div>

      {/* AI 润色建议：展示 diff 预览，确认后才写盘 */}
      {pendingAction && (
        <div className="border-t border-fg-faint/20 bg-canvas p-3 max-h-[45%] overflow-auto">
          <ConfirmableActionCard
            action={pendingAction}
            busy={actionBusy}
            onConfirm={confirmPending}
            onCancel={() => {
              pendingRef.current = null;
              setPendingAction(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
