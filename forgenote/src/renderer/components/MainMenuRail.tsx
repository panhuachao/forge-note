// 左侧主菜单图标列 - Obsidian 风格
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
  { id: 'graph', icon: 'globe', label: '图谱', requireKb: true },
  { id: 'template', icon: 'clipboard', label: '模板', requireKb: true },
  { id: 'audit', icon: 'clock', label: '历史', requireKb: true },
  { id: 'settings', icon: 'cog', label: '设置' }
];

export function MainMenuRail() {
  const { mainView, setMainView, toggleLeftRail } = useLayoutStore();
  const { activeKb, theme, setTheme } = useKBStore();

  return (
    <nav
      className="w-12 border-r border-ink-200 bg-ink-50 flex flex-col items-center py-2 gap-1"
      data-testid="main-menu-rail"
    >
      <div className="flex-1 flex flex-col items-center gap-1">
        {items.map((it) => {
          const disabled = !!it.requireKb && !activeKb;
          const active = mainView === it.id;
          return (
            <button
              key={it.id}
              onClick={() => !disabled && setMainView(it.id)}
              disabled={disabled}
              title={it.label}
              className={`group relative w-9 h-9 flex items-center justify-center rounded transition-colors ${
                active
                  ? 'bg-brand-100 text-brand-700'
                  : disabled
                  ? 'text-ink-300 cursor-not-allowed'
                  : 'text-ink-600 hover:bg-ink-200'
              }`}
            >
              <Icon name={it.icon} className="w-5 h-5" />
              <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-ink-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
                {it.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 底部：主题切换 + 收起主菜单 */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="group relative w-9 h-9 flex items-center justify-center rounded text-ink-600 hover:bg-ink-200 transition-colors"
          title={theme === 'light' ? '切换到暗黑模式' : '切换到亮白模式'}
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} className="w-5 h-5" />
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-ink-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
            {theme === 'light' ? '暗黑模式' : '亮白模式'}
          </span>
        </button>
        <button
          onClick={toggleLeftRail}
          className="group relative w-9 h-9 flex items-center justify-center rounded text-ink-600 hover:bg-ink-200 transition-colors"
          title="收起主菜单"
        >
          <Icon name="arrow-left" className="w-5 h-5" />
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-ink-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
            收起主菜单
          </span>
        </button>
      </div>
    </nav>
  );
}
