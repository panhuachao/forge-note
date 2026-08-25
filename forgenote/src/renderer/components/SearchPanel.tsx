import { useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import type { SearchResult } from '@shared/types';
import { Icon } from './Icon';

interface Props {
  onResultClick?: () => void;
}

export function SearchPanel({ onResultClick }: Props = {}) {
  const { activeKb, applied } = useKBStore();
  const { openTab, setMainView } = useLayoutStore();
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
    <div className="border-b border-border px-2 py-2">
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
          {searching ? <Icon name="x-circle" className="w-4 h-4" /> : <Icon name="search" className="w-4 h-4" />}
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
                {d.name}
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
              className="px-2 py-1 rounded hover:bg-hover-bg text-xs cursor-pointer"
              onClick={() => {
                setMainView('note');
                openTab(r.notePath);
                setResults([]);
                setQ('');
                onResultClick?.();
              }}
              title={r.notePath}
            >
              <div className="font-medium truncate">{r.noteName.replace(/\.md$/i, '')}</div>
              <div className="text-fg-muted line-clamp-1">{r.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
