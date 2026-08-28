// 执行后验证与回滚条（doc/AI智能管家重构方案.md §6.3 P2-3）
//
// 在此之前，确认流的生命周期是「确认 → 执行 → 结束」：
// 执行完既不校验是否真的生效，也不支持撤销，用户只能自己打开文件核对。
// 本组件补齐最后一环：执行后展示自动验证结果，未通过时提供一键回滚。
import { Icon } from './Icon';

interface Props {
  /** 自动验证结果；null 表示尚未执行/无需展示 */
  verify: { ok: boolean; message: string } | null;
  busy?: boolean;
  onRollback: () => void;
  onDismiss: () => void;
}

export function ActionVerifyBar({ verify, busy, onRollback, onDismiss }: Props) {
  if (!verify) return null;

  if (verify.ok) {
    return (
      <div className="my-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600">
        <Icon name="check-circle" className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1">{verify.message}</span>
        <button onClick={onDismiss} className="text-fg-faint hover:text-fg-secondary transition-colors">
          知道了
        </button>
      </div>
    );
  }

  return (
    <div className="my-1.5 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
      <Icon name="x-circle" className="w-3.5 h-3.5 text-amber-600 shrink-0" />
      <span className="text-[11px] text-fg-secondary flex-1">{verify.message}</span>
      <button
        onClick={onRollback}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-amber-500 text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <Icon name="arrow-path" className="w-3 h-3" />
        {busy ? '回滚中…' : '回滚'}
      </button>
      <button
        onClick={onDismiss}
        className="text-[11px] text-fg-faint hover:text-fg-secondary transition-colors"
      >
        忽略
      </button>
    </div>
  );
}
