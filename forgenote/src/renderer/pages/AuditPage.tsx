import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import type { AuditEntry } from '@shared/types';
import { PageHeader } from '../components/PageHeader';

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

  if (!activeKb) return <div className="flex-1 flex items-center justify-center text-fg-faint">请先选择知识库</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <PageHeader icon="clock" title="操作历史">
        <span className="text-xs text-fg-muted">{list.length} 条记录</span>
      </PageHeader>
      <div className="flex-1 overflow-y-auto p-6 pt-20">
        {list.length === 0 ? (
          <div className="text-center text-fg-faint py-12">暂无 AI 操作记录</div>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {list.map((e) => (
              <div key={e.id} className="bg-content rounded border border-border p-3 text-sm flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-brand">{e.action}</span>
                    <span className="text-xs text-fg-muted">{new Date(e.ts).toLocaleString()}</span>
                    {e.source?.startsWith('plugin:') && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        插件：{e.source.slice('plugin:'.length)}
                      </span>
                    )}
                    {e.undone && <span className="badge badge-gray">已撤销</span>}
                  </div>
                  <pre className="text-xs text-fg-secondary mt-1 truncate">{JSON.stringify(e.payload, null, 0)}</pre>
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
