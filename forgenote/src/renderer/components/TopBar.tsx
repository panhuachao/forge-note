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
      className="h-9 flex items-stretch border-b border-ink-200 bg-white text-xs select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左段：macOS 控件占位（让出红黄绿按钮） */}
      <div
        className="w-[72px] border-r border-ink-200 bg-ink-50"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />

      {/* 中段：多标签栏 + 新建按钮（白底） */}
      <div
        className="flex-1 flex items-stretch min-w-0 bg-white"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex-1 flex items-stretch overflow-x-auto min-w-0">
          {tabs.length === 0 ? (
            <div className="flex-1 flex items-center px-3 text-ink-400 text-xs">
              未打开笔记
            </div>
          ) : (
            tabs.map((t) => {
              const active = t.id === activeTabId;
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`group flex items-center gap-1.5 h-full px-3 border-r border-ink-200 cursor-pointer min-w-[120px] max-w-[280px] ${
                    active ? 'bg-ink-50 text-ink-900' : 'text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  {t.dirty && <span className="text-brand-600 text-base leading-none">●</span>}
                  <span className="truncate flex-1" title={t.notePath}>{t.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-ink-800"
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
              className="px-2 text-ink-400 hover:text-ink-700 h-full flex items-center"
              title="关闭所有标签"
            >
              <Icon name="x-mark" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* + 新建笔记 */}
        <button
          onClick={() => openCreateNote()}
          className="h-full w-9 flex items-center justify-center text-ink-500 hover:bg-ink-100 border-l border-ink-200"
          title="新建笔记"
        >
          <Icon name="plus" className="w-4 h-4" />
        </button>
      </div>

      {/* 右段：⮞ 收起右栏 */}
      <div
        className="flex items-stretch border-l border-ink-200 bg-ink-50"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={toggleRightPanel}
          className="h-full w-9 flex items-center justify-center text-ink-500 hover:bg-ink-200"
          title="收起属性面板"
        >
          <Icon name="chevron-right" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}