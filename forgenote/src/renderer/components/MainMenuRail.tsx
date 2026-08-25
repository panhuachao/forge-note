// 左侧主菜单图标列 - Obsidian 风格
// 整体下移 pt-9 让出 macOS 顶部窗口控件区域
// 视图切换（📁🔍🏷）已放到 LeftPanel 顶部（左侧顶部操作栏）
// 默认仅显示图标，鼠标悬停时弹出 tooltip 显示名称
import { useLayoutStore, MainView } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';
import { Icon, IconName } from './Icon';

interface MenuItem {
  id: MainView;
  icon: IconName;
  label: string;
  requireKb?: boolean;
}

const items: MenuItem[] = [
  { id: 'home', icon: 'home', label: '首页' },
  { id: 'note', icon: 'pencil', label: '笔记', requireKb: true },
  { id: 'chat', icon: 'chat-bubble', label: '对话', requireKb: true },
  { id: 'search-results', icon: 'search', label: '检索', requireKb: true },
  { id: 'graph', icon: 'globe', label: '图谱', requireKb: true },
  { id: 'template', icon: 'clipboard', label: '模板', requireKb: true },
  { id: 'audit', icon: 'clock', label: '历史', requireKb: true },
  { id: 'settings', icon: 'cog', label: '设置' }
];

export function MainMenuRail() {
  const { mainView, setMainView, toggleLeftRail } = useLayoutStore();
  const { activeKb, theme, setTheme, openQuickNote } = useKBStore();

  return (
    <nav
      className="w-14 border-r border-border bg-canvas flex flex-col items-center pt-10 pb-2 gap-1.5"
      data-testid="main-menu-rail"
    >
      {/* 快速笔记（最前面） */}
      <button
        onClick={openQuickNote}
        title="快速笔记：粘贴内容，AI 自动整理归档"
        className="group relative w-10 h-10 flex items-center justify-center rounded-xl bg-brand text-brand-fg shadow-sm hover:bg-brand-hover hover:shadow transition-all"
      >
        <Icon name="sparkles" className="w-5 h-5" />
        <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-canvas text-fg border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
          快速笔记
        </span>
      </button>

      {/* 分割 */}
      <div className="w-7 my-1 border-t border-border-soft" />

      {/* 主菜单图标（首页/笔记/图谱/模板/历史/设置） */}
      <div className="flex-1 flex flex-col items-center gap-1.5">
        {items.map((it) => {
          const disabled = !!it.requireKb && !activeKb;
          const active = mainView === it.id;
          return (
            <button
              key={it.id}
              onClick={() => !disabled && setMainView(it.id)}
              disabled={disabled}
              title={it.label}
              className={`group relative w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                active
                  ? 'bg-content text-brand shadow-sm'
                  : disabled
                  ? 'text-fg-faint cursor-not-allowed'
                  : 'text-fg-muted hover:bg-hover-bg hover:text-fg'
              }`}
            >
              <Icon name={it.icon} className="w-[22px] h-[22px]" />
              <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-canvas text-fg border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
                {it.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 底部：主题切换 + 收起主菜单 */}
      <div className="flex flex-col items-center gap-1.5">
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="group relative w-10 h-10 flex items-center justify-center rounded-xl text-fg-muted hover:bg-hover-bg hover:text-fg transition-colors"
          title={theme === 'light' ? '切换到暗黑模式' : '切换到亮白模式'}
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} className="w-[22px] h-[22px]" />
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-canvas text-fg border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
            {theme === 'light' ? '暗黑模式' : '亮白模式'}
          </span>
        </button>
        <button
          onClick={toggleLeftRail}
          className="group relative w-10 h-10 flex items-center justify-center rounded-xl text-fg-muted hover:bg-hover-bg hover:text-fg transition-colors"
          title="收起主菜单"
        >
          <Icon name="arrow-left" className="w-[22px] h-[22px]" />
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-canvas text-fg border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
            收起主菜单
          </span>
        </button>
      </div>
    </nav>
  );
}