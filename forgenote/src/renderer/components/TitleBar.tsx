import { useNavigate, useLocation } from 'react-router-dom';
import { useKBStore } from '../stores/kb-store';

export function TitleBar() {
  const nav = useNavigate();
  const loc = useLocation();
  const { activeKb, setTheme, theme } = useKBStore();

  const tabs = [
    { path: '/', label: '首页' },
    { path: '/graph', label: '图谱' },
    { path: '/template', label: '模板' },
    { path: '/audit', label: '历史' },
    { path: '/settings', label: '设置' }
  ];

  return (
    <div
      className="h-10 flex items-center pl-20 pr-3 border-b border-ink-200 bg-white select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-1 flex-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {tabs.map((t) => {
          const active = loc.pathname === t.path || (t.path !== '/' && loc.pathname.startsWith(t.path));
          return (
            <button
              key={t.path}
              onClick={() => nav(t.path)}
              className={`px-3 h-7 rounded text-sm transition-colors ${
                active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              {t.label}
            </button>
          );
        })}
        {activeKb && (
          <span className="ml-2 text-xs text-ink-500">
            · {activeKb.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="icon-btn"
          title="切换主题"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>
    </div>
  );
}
