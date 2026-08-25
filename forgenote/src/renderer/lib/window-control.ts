// 窗口控制：双击标题栏最大化/还原、标题栏可拖动由 CSS -webkit-app-region 控制
export function handleTitleBarDoubleClick() {
  window.forge?.win?.maximizeToggle().catch(() => {});
}

// 标题栏通用样式：可拖动（Electron 原生）
export const TITLEBAR_DRAG_STYLE: React.CSSProperties = {
  WebkitAppRegion: 'drag'
} as React.CSSProperties;

// 标题栏内交互元素（按钮等）需声明为 no-drag，避免点击被拖动吞掉
export const TITLEBAR_NO_DRAG_STYLE: React.CSSProperties = {
  WebkitAppRegion: 'no-drag'
} as React.CSSProperties;
