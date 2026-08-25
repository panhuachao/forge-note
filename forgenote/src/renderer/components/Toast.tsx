import { useKBStore } from '../stores/kb-store';

export function ToastContainer() {
  const { toasts, removeToast } = useKBStore();
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => {
        const color =
          t.level === 'success'
            ? 'bg-content border-green-500/40 text-green-600 dark:text-green-400'
            : t.level === 'error'
            ? 'bg-content border-red-500/40 text-red-600 dark:text-red-400'
            : t.level === 'warn'
            ? 'bg-content border-yellow-500/40 text-yellow-600 dark:text-yellow-400'
            : 'bg-content border-border text-fg';
        return (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            className={`px-3 py-2 rounded border shadow-sm text-sm cursor-pointer max-w-sm ${color}`}
          >
            {t.text}
          </div>
        );
      })}
    </div>
  );
}
