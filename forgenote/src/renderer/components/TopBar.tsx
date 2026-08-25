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
    toggleRightPanel
  } = useLayoutStore();
  const { openCreateNote } = useKBStore();

  return (
    <div
      className="h-10 flex items-center gap-2 pr-2 border-b border-border-soft bg-toolbar text-xs select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左段：macOS 控件占位（让出红黄绿按钮） */}
      <div
        className="w-[72px] h-full shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />

      {/* 中段：多标签栏 + 新建按钮（白底） */}
      <div
        className="flex-1 flex items-center min-w-0 gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex-1 flex items-center overflow-x-auto min-w-0 gap-1">
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
                  className={`group flex items-center gap-1.5 h-7 px-3 rounded-md cursor-pointer min-w-[110px] max-w-[240px] transition-all ${
                    active
                      ? 'bg-content text-fg shadow-sm'
                      : 'text-fg-muted hover:bg-hover-bg'
                  }`}
                  title={t.notePath}
                >
                  {t.dirty && <span className="text-brand text-[10px] leading-none shrink-0">●</span>}
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
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:bg-hover-bg hover:text-fg-secondary"
              title="关闭所有标签"
            >
              <Icon name="x-mark" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* + 新建笔记 */}
        <button
          onClick={() => openCreateNote()}
          className="shrink-0 w-8 h-7 flex items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-brand"
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
          className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-secondary"
          title="收起属性面板"
        >
          <Icon name="chevron-right" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}