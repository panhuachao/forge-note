import { useKBStore } from '../stores/kb-store';

export function ToastContainer() {
  const { toasts, removeToast } = useKBStore();
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => {
        const color =
          t.level === 'success'
            ? 'bg-green-50 border-green-300 text-green-800'
            : t.level === 'error'
            ? 'bg-red-50 border-red-300 text-red-800'
            : t.level === 'warn'
            ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
            : 'bg-white border-ink-200 text-ink-800';
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
