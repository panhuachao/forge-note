import { useEffect, useMemo, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from '../components/Icon';
import type { TagNote } from '@shared/types';

const PAGE_SIZE = 30;

/**
 * 标签笔记检索视图：按一级目录分组，宫格罗列，支持分页。
 * 通过左侧标签视图点击标签进入（layout-store.selectedTag）。
 */
export function TagNotesPage() {
  const { activeKb, pushToast } = useKBStore();
  const { selectedTag, setMainView, setSelectedTag, openTab } = useLayoutStore();
  const [notes, setNotes] = useState<TagNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!activeKb || !selectedTag) return;
    setLoading(true);
    setPage(1);
    (async () => {
      try {
        const list = await window.forge.fs.notesByTag(activeKb.id, selectedTag);
        setNotes(list);
      } catch (e) {
        pushToast({ level: 'error', text: '加载标签笔记失败：' + String(e) });
        setNotes([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeKb, selectedTag, pushToast]);

  // 当前页笔记
  const pageNotes = useMemo(
    () => notes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [notes, page]
  );
  const totalPages = Math.max(1, Math.ceil(notes.length / PAGE_SIZE));

  // 当前页按一级目录分组
  const groups = useMemo(() => {
    const map = new Map<string, TagNote[]>();
    for (const n of pageNotes) {
      const key = n.topDirName || '根目录';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    return [...map.entries()];
  }, [pageNotes]);

  if (!selectedTag) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-muted text-sm">
        请从左侧标签视图选择一个标签
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部标题栏：高度与左侧 ViewTabs 保持一致 */}
      <div
        className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-border-soft bg-toolbar"
      >
        <button
          onClick={() => setMainView('note')}
          className="btn btn-ghost text-xs"
          title="返回笔记"
        >
          <Icon name="chevron-left" className="w-4 h-4" />
        </button>
        <Icon name="tag" className="w-4 h-4 text-brand" />
        <span className="font-medium text-fg">#{selectedTag}</span>
        <span className="text-fg-faint text-xs">· 共 {notes.length} 篇</span>
        <div className="flex-1" />
        <button
          onClick={() => setSelectedTag(null)}
          className="text-fg-faint hover:text-fg-muted text-xs"
          title="清除"
        >
          <Icon name="x" className="w-4 h-4" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="text-fg-muted text-sm p-4">加载中…</div>
        ) : notes.length === 0 ? (
          <div className="text-fg-muted text-sm p-4">该标签下暂无笔记</div>
        ) : (
          <div className="space-y-5">
            {groups.map(([dirName, items]) => (
              <section key={dirName}>
                <div className="flex items-center gap-2 mb-2 text-fg-secondary">
                  <Icon name="folder-open" className="w-4 h-4 text-fg-muted" />
                  <span className="text-sm font-medium">{dirName}</span>
                  <span className="text-fg-faint text-xs">{items.length}</span>
                </div>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {items.map((n) => (
                    <button
                      key={n.path}
                      onClick={() => {
                        openTab(n.path);
                        setMainView('note');
                      }}
                      className="text-left rounded-lg border border-border-soft bg-content hover:border-brand/50 hover:bg-hover-bg/60 transition-colors p-3 flex flex-col gap-1 min-h-[88px]"
                    >
                      <span className="font-medium text-fg text-sm truncate">
                        {n.name.replace(/\.md$/i, '')}
                      </span>
                      <span className="text-xs text-fg-faint truncate">{n.dirPath || '根目录'}</span>
                      <span className="text-[11px] text-fg-faint mt-auto">
                        {new Date(n.mtime).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* 分页栏 */}
      {totalPages > 1 && (
        <div className="shrink-0 h-11 flex items-center justify-center gap-1 border-t border-border-soft bg-toolbar">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn btn-ghost text-xs"
          >
            上一页
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-7 h-7 rounded-md text-xs ${
                p === page ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:bg-hover-bg'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn btn-ghost text-xs"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
