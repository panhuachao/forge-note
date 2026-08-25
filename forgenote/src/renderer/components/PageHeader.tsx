import { Icon } from './Icon';

interface Props {
  icon: string;
  title: string;
  /** 右侧可放置操作按钮等 */
  children?: React.ReactNode;
}

// 统一的页面顶部标题栏：
// 高度 h-14，固定定位覆盖整个窗口顶部一行（w-screen），
// 下边线 border-b 贯通 MainMenuRail 与中列 / 右栏之间 → 形成一条
// "从窗口最左到最右"的标题栏分割线，主菜单整体位于分割线之下。
// macOS 红黄绿按钮（hiddenInset）始终在最上层，浮于 PageHeader 背景之上。
// 标题内容 pl-[72px] 推到 macOS 按钮右侧。
export function PageHeader({ icon, title, children }: Props) {
  return (
    <div className="fixed top-0 left-0 right-0 z-20 h-14 flex items-center pl-[72px] pr-4 border-b border-border bg-toolbar text-sm">
      <span className="font-semibold flex items-center gap-2 text-base">
        <Icon name={icon} className="w-5 h-5 text-brand" />
        {title}
      </span>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}
