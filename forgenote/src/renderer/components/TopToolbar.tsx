// 顶部工具栏：仅多标签栏（Obsidian 风格）
// 视图切换、快捷操作、AI 操作分别移至 LeftPanel / RightPanel 顶部
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';

export function TopToolbar() {
  const {
    tabs, activeTabId, setActiveTab, closeTab, closeAllTabs
  } = useLayoutStore();
  const { openCreateNote } = useKBStore();

  return (
    <div
      className="h-8 flex items-center bg-ink-50 border-b border-ink-200 text-xs"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex-1 flex items-center overflow-x-auto h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {tabs.length === 0 ? (
          <div className="px-3 text-ink-400 text-xs">未打开笔记</div>
        ) : (
          tabs.map((t) => {
            const active = t.id === activeTabId;
            return (
              <div
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`group flex items-center gap-1 h-full px-3 border-r border-ink-200 cursor-pointer min-w-[120px] max-w-[280px] ${
                  active ? 'bg-white text-ink-900' : 'text-ink-600 hover:bg-white/50'
                }`}
              >
                {t.dirty && <span className="text-brand-600 text-base leading-none">●</span>}
                <span className="truncate flex-1" title={t.notePath}>{t.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-ink-800 text-sm"
                  title="关闭"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
        {tabs.length > 0 && (
          <button
            onClick={closeAllTabs}
            className="px-2 text-ink-400 hover:text-ink-700 h-full text-xs"
            title="关闭所有标签"
          >×</button>
        )}
      </div>
      {/* + 新建笔记按钮（Obsidian 风格） */}
      <button
        onClick={() => openCreateNote()}
        className="h-full w-8 flex items-center justify-center text-ink-500 hover:bg-ink-100 border-l border-ink-200 text-base"
        title="新建笔记"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        ＋
      </button>
    </div>
  );
}
