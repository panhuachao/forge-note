import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';

/**
 * 未配置 AI 模型时，用户触发任何 AI 功能后的引导弹窗。
 * 提示用户配置大模型，并提供「去配置」按钮跳转设置页（高级设置 → AI 配置）。
 */
export function AISetupGuideModal() {
  const open = useKBStore((s) => s.aiSetupGuideOpen);
  const close = useKBStore((s) => s.closeAISetupGuide);
  const pushToast = useKBStore((s) => s.pushToast);

  if (!open) return null;

  const goSettings = () => {
    close();
    useLayoutStore.getState().setMainView('settings');
    pushToast({ level: 'info', text: '请在「高级设置 → AI 模型配置」中填写 provider 与 model' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-content shadow-2xl border border-border-soft p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-brand/10 text-brand flex items-center justify-center flex-shrink-0">
            <Icon name="sparkles" className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-semibold">需要配置 AI 大模型</h2>
        </div>
        <p className="text-sm text-fg-secondary leading-relaxed mb-2">
          该功能依赖 AI 大模型能力，但当前尚未配置任何模型。请先在设置中配置一个
          AI 模型（如 OpenAI、通义千问、DeepSeek 等），即可使用 AI 对话、快速推荐、
          智能标签、AI 整理等功能。
        </p>
        <p className="text-xs text-fg-muted mb-5">
          配置路径：设置 → 基础设置 → AI 模型配置。
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={close}>
            稍后
          </button>
          <button className="btn btn-primary" onClick={goSettings}>
            去配置 AI 模型
          </button>
        </div>
      </div>
    </div>
  );
}

// 局部 Icon 组件（避免额外依赖）
function Icon({ name, className }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  if (name === 'sparkles') {
    return (
      <svg {...common}>
        <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" />
        <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
      </svg>
    );
  }
  return null;
}
