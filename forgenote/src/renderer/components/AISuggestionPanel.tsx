import { useState } from 'react';
import type { LinkInfo, DirSuggestion } from '@shared/types';

interface Props {
  linkSuggestions: LinkInfo[];
  dirSuggestions: DirSuggestion[];
  summary: string | null;
  onApplyLinks: (targets: string[]) => Promise<void>;
  onApplyDir: (dirPath: string) => Promise<void>;
  onCloseSummary: () => void;
}

export function AISuggestionPanel({
  linkSuggestions,
  dirSuggestions,
  summary,
  onApplyLinks,
  onApplyDir,
  onCloseSummary
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(t: string) {
    const ns = new Set(selected);
    if (ns.has(t)) ns.delete(t);
    else ns.add(t);
    setSelected(ns);
  }

  return (
    <div className="px-4 py-3 space-y-4">
      {summary && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-semibold text-ink-500 uppercase">AI 摘要</h3>
            <button onClick={onCloseSummary} className="text-ink-400 hover:text-ink-800 text-xs">×</button>
          </div>
          <pre className="text-xs text-ink-700 whitespace-pre-wrap bg-ink-50 rounded p-2 max-h-40 overflow-y-auto">
            {summary}
          </pre>
        </div>
      )}

      {dirSuggestions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-ink-500 uppercase mb-2">AI 归纳推荐</h3>
          <div className="space-y-1.5">
            {dirSuggestions.map((s) => (
              <div
                key={s.dirId}
                className="p-2 rounded border border-ink-200 hover:border-brand-600 cursor-pointer"
                onClick={() => onApplyDir(s.dirPath)}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.dirName}</span>
                  <span className="badge badge-brand">{Math.round(s.confidence * 100)}%</span>
                </div>
                <div className="text-xs text-ink-500 mt-0.5">{s.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {linkSuggestions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-ink-500 uppercase">AI 链接推荐</h3>
            {selected.size > 0 && (
              <button
                onClick={() => onApplyLinks([...selected])}
                className="btn btn-primary text-xs px-2 py-0.5"
              >
                应用 ({selected.size})
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {linkSuggestions.map((s) => (
              <label
                key={s.target}
                className="flex items-start gap-2 p-2 rounded border border-ink-200 hover:border-brand-600 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.target)}
                  onChange={() => toggle(s.target)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-1">
                    {s.target}
                    {s.kind === 'flow' && <span className="badge badge-brand text-[10px]">流向</span>}
                  </div>
                  <div className="text-xs text-ink-500">{s.reason}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
