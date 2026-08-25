import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useKBStore } from '../stores/kb-store';
import type { SearchResult } from '@shared/types';

export function SearchPanel() {
  const nav = useNavigate();
  const { activeKb, applied } = useKBStore();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dirFilter, setDirFilter] = useState<string[]>([]);

  async function doSearch() {
    if (!activeKb || !q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await window.forge.search.query(activeKb.id, q.trim(), { templateDirIds: dirFilter });
      setResults(r);
    } finally {
      setSearching(false);
    }
  }

  function toggleDir(id: string) {
    setDirFilter((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div className="border-b border-ink-200 px-2 py-2">
      <div className="flex items-center gap-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doSearch();
          }}
          placeholder="搜索…"
          className="input text-sm"
        />
        <button
          onClick={doSearch}
          disabled={searching}
          className="icon-btn"
          title="搜索"
        >
          {searching ? '…' : '🔍'}
        </button>
      </div>
      {applied && applied.meta.dirs.length > 0 && q.trim() && (
        <div className="mt-2 flex flex-wrap gap-1">
          {applied.meta.dirs.map((d) => {
            const on = dirFilter.includes(d.id);
            return (
              <button
                key={d.id}
                onClick={() => toggleDir(d.id)}
                className={`badge ${on ? 'badge-brand' : 'badge-gray'} cursor-pointer`}
                title="按目录过滤"
              >
                {d.icon} {d.name}
              </button>
            );
          })}
        </div>
      )}
      {results.length > 0 && (
        <div className="mt-2 max-h-60 overflow-y-auto">
          {results.map((r) => (
            <div
              key={r.notePath}
              className="px-2 py-1 rounded hover:bg-ink-100 text-xs cursor-pointer"
              onClick={() => {
                nav(`/note/${encodeURIComponent(r.notePath)}`);
                setResults([]);
                setQ('');
              }}
              title={r.notePath}
            >
              <div className="font-medium truncate">{r.noteName.replace(/\.md$/i, '')}</div>
              <div className="text-ink-500 line-clamp-1">{r.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
