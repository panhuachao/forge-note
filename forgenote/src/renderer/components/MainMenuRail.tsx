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
  { id: 'note', icon: 'folder', label: '笔记', requireKb: true },
  { id: 'graph', icon: 'share', label: '图谱', requireKb: true },
  { id: 'chat', icon: 'chat-bubble', label: '对话', requireKb: true },
  { id: 'search-results', icon: 'search', label: '检索', requireKb: true },
  { id: 'template', icon: 'clipboard', label: '模板', requireKb: true }
];

export function MainMenuRail() {
  const { mainView, setMainView } = useLayoutStore();
  const { activeKb, theme, setTheme, openQuickNote } = useKBStore();

  return (
    <nav
      className="w-14 border-r border-border-soft bg-canvas flex flex-col items-center pb-2 gap-1.5"
      data-testid="main-menu-rail"
    >
      {/* 顶部标题栏区域：与三栏操作栏同高同色（bg-toolbar），
        macOS 红黄绿按钮（hiddenInset）浮在其上。
        支持双击放大/还原、按住拖动（Electron -webkit-app-region: drag）。 */}
    <div
      className="h-12 w-full bg-toolbar shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={() => window.forge?.win?.maximizeToggle().catch(() => {})}
    />
      {/* 菜单按钮区顶部间距 */}
      <div className="mt-2" />

      {/* 快速笔记 + 灵感：一组操作入口 */}
      <button
        onClick={openQuickNote}
        title="快速笔记：粘贴内容，AI 自动整理归档"
        className="group relative w-10 h-10 flex items-center justify-center rounded-xl bg-brand text-brand-fg shadow-sm hover:bg-brand-hover hover:shadow transition-all"
      >
        <Icon name="plus" className="w-5 h-5" />
        <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-canvas text-fg border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
          快速笔记
        </span>
      </button>
      <button
        onClick={() => activeKb && setMainView('inspiration')}
        disabled={!activeKb}
        title="灵感工坊"
        className={`group relative w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
          mainView === 'inspiration'
            ? 'bg-brand-soft text-brand'
            : activeKb
            ? 'text-fg-muted hover:bg-hover-bg hover:text-fg'
            : 'text-fg-faint cursor-not-allowed'
        }`}
      >
        <Icon name="light-bulb" className="w-5 h-5" />
        <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-canvas text-fg border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
          灵感工坊
        </span>
      </button>

      {/* 分割 */}
      <div className="w-7 my-1 border-t border-border-soft" />

      {/* 主菜单图标（首页/笔记/图谱/模板/历史/设置） */}
      <div className="flex-1 flex flex-col items-center gap-2">
        {items.map((it) => {
          const disabled = !!it.requireKb && !activeKb;
          const active = mainView === it.id;
          return (
            <button
              key={it.id}
              onClick={() => !disabled && setMainView(it.id)}
              disabled={disabled}
              title={it.label}
              className={`group relative w-11 h-11 flex items-center justify-center rounded-2xl transition-all ${
                active
                  ? 'bg-brand-soft text-brand'
                  : disabled
                  ? 'text-fg-faint cursor-not-allowed'
                  : 'text-fg-muted hover:bg-hover-bg hover:text-fg'
              }`}
            >
              <Icon name={it.icon} className="w-[23px] h-[23px]" />
              <span className="pointer-events-none absolute left-full ml-2 px-2.5 py-1 rounded-xl bg-canvas text-fg border border-border-soft text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-sm">
                {it.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 底部：主题切换 + 设置 */}
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
          onClick={() => setMainView('settings')}
          title="设置"
          className={`group relative w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
            mainView === 'settings'
              ? 'bg-content text-brand shadow-sm'
              : 'text-fg-muted hover:bg-hover-bg hover:text-fg'
          }`}
        >
          <Icon name="cog" className="w-[22px] h-[22px]" />
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-canvas text-fg border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
            设置
          </span>
        </button>
      </div>
    </nav>
  );
}