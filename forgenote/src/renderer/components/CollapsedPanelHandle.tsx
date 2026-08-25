// 面板折叠时显示的展开按钮
import { useLayoutStore } from '../stores/layout-store';

export function CollapsedLeftHandle() {
  const { toggleLeftPanel } = useLayoutStore();
  return (
    <div
      className="w-6 border-r border-ink-200 bg-white flex flex-col items-center pt-2"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={toggleLeftPanel}
        title="展开侧栏"
        className="w-6 h-9 flex items-center justify-center text-ink-500 hover:bg-ink-100 rounded"
      >
        ⮞
      </button>
    </div>
  );
}

export function CollapsedRightHandle() {
  const { toggleRightPanel } = useLayoutStore();
  return (
    <div
      className="w-6 border-l border-ink-200 bg-white flex flex-col items-center pt-2"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={toggleRightPanel}
        title="展开属性面板"
        className="w-6 h-9 flex items-center justify-center text-ink-500 hover:bg-ink-100 rounded"
      >
        ⮜
      </button>
    </div>
  );
}
