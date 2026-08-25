// 顶部统一工具栏（与窗口控件同一行）
// 布局：
//   左段：macOS 红黄绿控件占位 + 收起左栏（⮜）
//   中段：多标签栏 + 新建按钮（白底）
//   右段：收起右栏（⮞）
// 视图切换（📁🔍📄）、快捷操作、大纲/搜索标签
// 分别移到 LeftPanel / RightPanel 各自的顶部操作栏
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';
import { Icon } from './Icon';

export function TopBar() {
  const {
    tabs, activeTabId, setActiveTab, closeTab, closeAllTabs,
    toggleLeftPanel, toggleRightPanel
  } = useLayoutStore();
  const { openCreateNote } = useKBStore();

  return (
    <div
      className="h-9 flex items-stretch border-b border-ink-200 bg-white text-xs select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左段：macOS 红黄绿控件占位 + 收起左栏
          - pl-[72px] 让出 macOS 红黄绿按钮（约 70px 宽）
          - 背景浅灰 */}
      <div
        className="flex items-stretch border-r border-ink-200 bg-ink-50 pl-[72px]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={toggleLeftPanel}
          className="h-full w-9 flex items-center justify-center text-ink-500 hover:bg-ink-200"
          title="收起侧栏"
        >
          <Icon name="chevron-left" className="w-4 h-4" />
        </button>
      </div>

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

      {/* 右段：收起右栏（⮞） */}
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