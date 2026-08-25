// 顶部多标签栏（与窗口控件同一行）
//   左段：macOS 控件占位（pl-[72px]）
//   中段：多标签 + ＋ 新建
//   右段：⮞ 收起右栏
// 视图切换（📁🔍🏷）已下移至主菜单栏顶部
// 快捷操作已下移至视图内部顶部
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';
import { Icon } from './Icon';

export function TopBar() {
  const {
    tabs, activeTabId, setActiveTab, closeTab, closeAllTabs,
    toggleRightPanel, toggleLeftPanel, leftPanelCollapsed, rightPanelCollapsed
  } = useLayoutStore();
  const { openCreateNote } = useKBStore();

  // 双击标题栏：最大化 / 还原
  const handleDoubleClick = () => {
    window.forge.win?.maximizeToggle().catch(() => {});
  };

  // 专注模式：同时收起左右栏，让编辑区独占窗口
  const toggleFocus = () => {
    if (!leftPanelCollapsed) toggleLeftPanel();
    if (!rightPanelCollapsed) toggleRightPanel();
  };

  return (
    <div
      className="h-12 flex items-center gap-2 pr-2.5 border-b border-border-soft bg-toolbar text-xs select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleDoubleClick}
    >
      {/* 左段：专注模式按钮 */}
      <div
        className="flex items-center shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={toggleFocus}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-muted hover:bg-hover-bg hover:text-brand transition-colors"
          title="专注模式（隐藏左右侧栏）"
        >
          <Icon name="focus" className="w-4 h-4" />
        </button>
      </div>

      {/* 中段：多标签栏 + 新建按钮 */}
      <div className="flex-1 flex items-center min-w-0 gap-1.5">
        <div
          className="flex-1 flex items-center overflow-x-auto min-w-0 gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {tabs.length === 0 ? (
            <div className="flex items-center px-2 text-fg-muted text-xs">
              未打开笔记
            </div>
          ) : (
            tabs.map((t) => {
              const active = t.id === activeTabId;
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  className={`group flex items-center gap-1.5 h-8 px-3.5 rounded-full cursor-pointer min-w-[110px] max-w-[240px] transition-all border ${
                    active
                      ? 'bg-brand-soft text-brand border-brand/20 font-medium'
                      : 'text-fg-muted border-transparent hover:bg-hover-bg'
                  }`}
                  title={t.notePath}
                >
                  {t.dirty && <span className={`text-[9px] leading-none shrink-0 ${active ? 'text-brand' : 'text-fg-faint'}`}>●</span>}
                  <span className="truncate flex-1">{t.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-fg rounded p-0.5"
                    title="关闭"
                  >
                    <Icon name="x-mark" className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
          {tabs.length > 0 && (
            <button
              onClick={closeAllTabs}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-fg-faint hover:bg-hover-bg hover:text-fg-secondary transition-colors"
              title="关闭所有标签"
            >
              <Icon name="x-mark" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* + 新建笔记 */}
        <button
          onClick={() => openCreateNote()}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-fg-muted hover:bg-hover-bg hover:text-brand transition-colors"
          title="新建笔记"
        >
          <Icon name="plus" className="w-4 h-4" />
        </button>
      </div>

      {/* 右段：⮞ 收起右栏 */}
      <div
        className="flex items-center shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={toggleRightPanel}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-fg-muted hover:bg-hover-bg hover:text-fg-secondary transition-colors"
          title="收起属性面板"
        >
          <Icon name="chevron-right" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}