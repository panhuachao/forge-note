import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import type { AuditEntry } from '@shared/types';

export function AuditPage() {
  const { activeKb, pushToast } = useKBStore();
  const [list, setList] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!activeKb) return;
    window.forge.audit.list(activeKb.id).then(setList);
  }, [activeKb?.id]);

  async function undo(id: string) {
    if (!activeKb) return;
    try {
      await window.forge.audit.undo(activeKb.id, id);
      const l = await window.forge.audit.list(activeKb.id);
      setList(l);
      pushToast({ level: 'success', text: '已撤销' });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }

  if (!activeKb) return <div className="flex-1 flex items-center justify-center text-ink-400">请先选择知识库</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-ink-50">
      <div className="h-10 flex items-center px-4 border-b border-ink-200 bg-white text-sm">
        <span className="font-medium">🕓 操作历史</span>
        <span className="ml-3 text-xs text-ink-500">{list.length} 条记录</span>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {list.length === 0 ? (
          <div className="text-center text-ink-400 py-12">暂无 AI 操作记录</div>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {list.map((e) => (
              <div key={e.id} className="bg-white rounded border border-ink-200 p-3 text-sm flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-brand">{e.action}</span>
                    <span className="text-xs text-ink-500">{new Date(e.ts).toLocaleString()}</span>
                    {e.undone && <span className="badge badge-gray">已撤销</span>}
                  </div>
                  <pre className="text-xs text-ink-600 mt-1 truncate">{JSON.stringify(e.payload, null, 0)}</pre>
                </div>
                {!e.undone && (
                  <button onClick={() => undo(e.id)} className="btn btn-ghost text-xs">撤销</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
