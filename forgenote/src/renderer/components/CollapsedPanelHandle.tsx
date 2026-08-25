// 面板折叠时显示的展开按钮
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from './Icon';

export function CollapsedLeftHandle() {
  const { toggleLeftPanel } = useLayoutStore();
  return (
    <div
      className="w-6 border-r border-border bg-content flex flex-col items-center pt-2"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={toggleLeftPanel}
        title="展开侧栏"
        className="w-6 h-9 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded"
      >
        <Icon name="chevron-right" className="w-4 h-4" />
      </button>
    </div>
  );
}

export function CollapsedRightHandle() {
  const { toggleRightPanel } = useLayoutStore();
  return (
    <div
      className="w-6 border-l border-border bg-content flex flex-col items-center pt-2"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={toggleRightPanel}
        title="展开属性面板"
        className="w-6 h-9 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded"
      >
        <Icon name="chevron-left" className="w-4 h-4" />
      </button>
    </div>
  );
}
