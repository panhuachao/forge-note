// 顶部标题栏 - 仅作为窗口拖动区（无内容）
// 实际控件（视图标签/多标签/属性折叠）已移至中间顶部工具条
export function TitleBar() {
  return (
    <div
      className="h-10 border-b border-ink-200 bg-white select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    />
  );
}
