import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { resolveWikiLink, openWikiLink } from '../utils/wikilink';
import { useKBStore } from '../stores/kb-store';

interface PreviewState {
  name: string;
  path: string | null;
  x: number;
  y: number;
}

// 点击 [[笔记链接]] 显示的浮窗：展示笔记属性基本信息；双击链接直接跳转
export function WikiLinkLayer() {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [meta, setMeta] = useState<{
    title: string;
    summary: string;
    tags: string[];
    size: number;
    mtime?: number;
    ctime?: number;
    found: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 文档级事件委托：单击显示浮窗，双击跳转（覆盖所有页面的 markdown 渲染）
  useEffect(() => {
    const getLinkName = (target: EventTarget | null): string | null => {
      const el = target as HTMLElement | null;
      const a = el?.closest('a.wiki-link') as HTMLAnchorElement | null;
      if (!a) return null;
      return decodeURIComponent((a.getAttribute('href') || '').replace(/^#wiki=/, '')) || null;
    };

    const onClick = (e: MouseEvent) => {
      const name = getLinkName(e.target);
      if (!name) {
        // 点击浮窗外部关闭
        if (!(e.target as HTMLElement)?.closest('[data-wikilink-popover]')) {
          setPreview(null);
          setMeta(null);
        }
        return;
      }
      e.preventDefault();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      const x = Math.min(e.clientX + 12, window.innerWidth - 320);
      const y = Math.min(e.clientY + 12, window.innerHeight - 240);
      setPreview({ name, path: null, x, y });
      setLoading(true);
      setMeta(null);
      // 解析并读取基本信息
      (async () => {
        const path = await resolveWikiLink(name);
        if (!path) {
          setLoading(false);
          setMeta({ title: name, summary: '', tags: [], size: 0, found: false });
          return;
        }
        const { activeKb } = useKBStore.getState();
        if (!activeKb) {
          setLoading(false);
          setMeta({ title: name, summary: '', tags: [], size: 0, found: false });
          return;
        }
        try {
          const note = await window.forge.fs.readNote(activeKb.id, path);
          const fm = note.frontmatter || {};
          const tagsRaw = fm.tags;
          const tags = Array.isArray(tagsRaw)
            ? (tagsRaw as unknown[]).map((t) => String(t)).filter(Boolean)
            : typeof tagsRaw === 'string' && tagsRaw
              ? tagsRaw.split(/[#,，\s]+/).map((s) => s.trim()).filter(Boolean)
              : [];
          const summary = typeof fm.summary === 'string' ? fm.summary : '';
          setMeta({
            title: name,
            summary,
            tags,
            size: note.content.length,
            mtime: note.mtime,
            ctime: note.ctime,
            found: true
          });
        } catch {
          setMeta({ title: name, summary: '', tags: [], size: 0, found: false });
        } finally {
          setLoading(false);
        }
      })();
    };

    const onDblClick = (e: MouseEvent) => {
      const name = getLinkName(e.target);
      if (!name) return;
      e.preventDefault();
      setPreview(null);
      setMeta(null);
      openWikiLink(name);
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onDblClick, true);
    };
  }, []);

  if (!preview) return null;

  const fmtDate = (ts?: number) =>
    ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div
      data-wikilink-popover
      className="fixed z-[1000] w-72 rounded-2xl border border-border-soft bg-content shadow-2xl p-4 text-sm"
      style={{ left: preview.x, top: preview.y }}
    >
      {loading && <div className="text-fg-muted text-xs">加载中…</div>}
      {!loading && meta && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Icon name="document" className="w-4 h-4 text-brand shrink-0" />
            <span className="font-semibold text-fg truncate">{meta.title}</span>
            {meta.found ? (
              <span className="ml-auto text-[10px] text-emerald-500 shrink-0">已找到</span>
            ) : (
              <span className="ml-auto text-[10px] text-rose-400 shrink-0">未找到</span>
            )}
          </div>
          {meta.summary && (
            <p className="text-fg-secondary text-xs leading-relaxed mb-2 line-clamp-3">{meta.summary}</p>
          )}
          {meta.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {meta.tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-md bg-brand-soft/40 text-brand">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 text-[10px] text-fg-faint border-t border-border-soft pt-2">
            <span>字数 {meta.size}</span>
            <span>修改 {fmtDate(meta.mtime)}</span>
            {meta.ctime ? <span>创建 {fmtDate(meta.ctime)}</span> : null}
          </div>
          {meta.found && (
            <button
              onClick={() => {
                const n = preview.name;
                setPreview(null);
                openWikiLink(n);
              }}
              className="mt-2 w-full h-7 rounded-lg bg-brand text-brand-fg text-xs font-medium hover:bg-brand-hover transition-colors"
            >
              打开笔记
            </button>
          )}
          {!meta.found && (
            <div className="mt-2 text-[10px] text-fg-faint">未找到该笔记，可双击改用搜索</div>
          )}
        </>
      )}
    </div>
  );
}
