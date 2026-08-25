import { useState } from 'react';
import type { CardDraft } from '@shared/types';
import { useKBStore } from '../stores/kb-store';
import { Icon } from './Icon';

interface Props {
  draft: CardDraft;
  onClose: () => void;
  onConfirm: (targetDirPath: string) => Promise<void>;
}

export function ForgeCardModal({ draft, onClose, onConfirm }: Props) {
  const { applied } = useKBStore();
  const [title, setTitle] = useState(draft.title);
  const [coreIdea, setCoreIdea] = useState(draft.coreIdea);
  const [details, setDetails] = useState(draft.details);
  const [actionable, setActionable] = useState(draft.actionable.join('\n'));
  const [verification, setVerification] = useState(draft.verification);
  const [target, setTarget] = useState(draft.suggestedTarget.dirId);

  const targets = (applied?.meta.dirs || []).filter((d) => ['01', '02', '06'].includes(d.id));

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-8">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-1.5"><Icon name="sparkles" className="w-4 h-4 text-brand-600" /> 锻造知识卡片</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-800">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3 text-sm">
          <div>
            <label className="text-xs text-ink-500">标题</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </div>
          <div>
            <label className="text-xs text-ink-500">核心观点</label>
            <textarea value={coreIdea} onChange={(e) => setCoreIdea(e.target.value)} rows={2} className="input" />
          </div>
          <div>
            <label className="text-xs text-ink-500">详细内容</label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4} className="input" />
          </div>
          <div>
            <label className="text-xs text-ink-500">可行动项（每行一条）</label>
            <textarea value={actionable} onChange={(e) => setActionable(e.target.value)} rows={3} className="input" />
          </div>
          <div>
            <label className="text-xs text-ink-500">验证标准</label>
            <textarea value={verification} onChange={(e) => setVerification(e.target.value)} rows={2} className="input" />
          </div>
          <div>
            <label className="text-xs text-ink-500">流转目标</label>
            <div className="flex gap-2 mt-1">
              {targets.map((d) => (
                <label
                  key={d.id}
                  className={`px-3 py-1.5 rounded border cursor-pointer ${
                    target === d.id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="target"
                    value={d.id}
                    checked={target === d.id}
                    onChange={() => setTarget(d.id)}
                    className="hidden"
                  />
                  {d.id} {d.name}
                </label>
              ))}
            </div>
            {draft.suggestedTarget.reason && (
              <p className="text-xs text-ink-500 mt-2">AI 建议：{draft.suggestedTarget.reason}</p>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-ink-200 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">取消</button>
          <button
            onClick={async () => {
              const d = targets.find((x) => x.id === target);
              if (!d) return;
              const dirName = `${d.id} ${d.name}`;
              await onConfirm(dirName);
            }}
            className="btn btn-primary"
          >
            确认锻造
          </button>
        </div>
      </div>
    </div>
  );
}
