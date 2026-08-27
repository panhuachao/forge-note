import { useEffect, useState } from 'react';

/**
 * 通用确认弹窗（主题色 OK / Cancel）。
 * 取代 window.confirm —— 原生 confirm 在 Electron / Webview 下颜色与项目主题脱节，
 * 且样式不可控（参见删除对话弹窗 OK 按钮显示为系统蓝的 bug）。
 *
 * 用法：受控组件，父组件用 open / onClose / onConfirm 控制。
 * - open: 是否显示
 * - title: 标题（必填）
 * - message: 描述，支持多行 / \n
 * - confirmText / cancelText: 自定义按钮文案
 * - danger: true 时 OK 按钮用红色 destructive 样式（默认主题色）
 * - onConfirm: 用户点 OK 回调
 * - onClose: 用户点 Cancel / ESC / 遮罩 回调
 */
interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onClose
}: Props) {
  // 防止动画过程中重复触发
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !busy) {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  if (!open) return null;

  function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      onConfirm();
    } finally {
      // 大多数调用方在 onConfirm 内会主动关闭弹窗（设置 open=false），这里兜底 reset
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] bg-content border border-border-soft rounded-xl shadow-xl p-6 text-fg-primary"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {message && (
          <p className="mt-2 text-sm leading-relaxed text-fg-secondary whitespace-pre-line">
            {message}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="btn btn-secondary px-5 py-2 text-sm disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className={`px-5 py-2 text-sm rounded-xl font-medium transition-all shadow-sm hover:shadow disabled:opacity-50 ${
              danger
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-brand text-brand-fg hover:bg-brand-hover'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}