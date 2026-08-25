// 笔记检索结果页面
// 顶部：搜索栏 + 返回
// 下方：搜索匹配的笔记列表

import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import type { SearchResult } from '@shared/types';
import { Icon } from '../components/Icon';

export default function SearchResultsPage() {
  const activeKb = useKBStore((s) => s.activeKb);
  const kbs = useKBStore((s) => s.kbs);
  const setActiveKb = useKBStore((s) => s.setActiveKb);

  const openTab = useLayoutStore((s) => s.openTab);
  const setMainView = useLayoutStore((s) => s.setMainView);

  // 全局传入的 query（来自 HomePage）
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false); // 是否已搜索过

  useEffect(() => {
    // 监听全局 search-init 事件（HomePage 进入时派发）
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ q: string }>;
      if (ce.detail?.q) {
        setQuery(ce.detail.q);
        runSearch(ce.detail.q);
      }
    };
    window.addEventListener('forge:search-init', handler as EventListener);
    return () => window.removeEventListener('forge:search-init', handler as EventListener);
  }, [activeKb?.id]);

  const runSearch = async (q: string) => {
    if (!activeKb || !q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    setSearched(true);
    try {
      const r = await window.forge.search.query(activeKb.id, q.trim(), { limit: 50 });
      setResults(r);
    } catch (err) {
      console.error('[SearchResultsPage] search failed:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const onSubmit = () => {
    runSearch(query);
  };

  const onOpenResult = (r: SearchResult) => {
    setMainView('note');
    openTab(r.notePath);
  };

  return (
    <div className="flex-1 flex flex-col bg-ink-50 overflow-hidden">
      {/* 顶部：返回 + 搜索栏 + 知识库 */}
      <div className="h-14 px-4 flex items-center gap-3 border-b border-ink-200 bg-white">
        <button
          onClick={() => setMainView('home')}
          className="w-8 h-8 flex items-center justify-center text-ink-500 hover:bg-ink-100 rounded-lg flex-shrink-0"
          title="返回首页"
        >
          <Icon name="arrow-left" className="w-4 h-4" />
        </button>

        {/* 搜索输入框（占据主要宽度） */}
        <div className="flex-1 max-w-2xl flex items-center gap-2 px-3 h-9 rounded-lg border border-ink-200 bg-ink-50 focus-within:border-brand-400 focus-within:bg-white transition-colors">
          <Icon name="search" className="w-4 h-4 text-ink-400 flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
            placeholder="在所有笔记中检索关键词…"
            className="flex-1 bg-transparent outline-none text-sm text-ink-800 placeholder:text-ink-400"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="w-5 h-5 flex items-center justify-center text-ink-400 hover:text-ink-600"
              title="清空"
            >
              <Icon name="x-mark" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 知识库切换 */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-ink-100 text-xs text-ink-600 hover:bg-ink-200">
            <Icon name="folder" className="w-3.5 h-3.5" />
            <span>{activeKb?.name || '未选择'}</span>
            <Icon name="chevron-down" className="w-3 h-3" />
          </button>
          <div className="absolute right-0 top-full mt-1 bg-white border border-ink-200 rounded-lg shadow-lg z-30 hidden group-hover:block min-w-[200px]">
            {kbs.map((kb) => (
              <button
                key={kb.id}
                onClick={async () => {
                  await window.forge.kb.setActive(kb.id);
                  const active = await window.forge.kb.getActive();
                  if (active) {
                    setActiveKb(active);
                    // 切换后自动重跑
                    setTimeout(() => runSearch(query), 50);
                  }
                }}
                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-ink-100 ${
                  activeKb?.id === kb.id ? 'text-brand-600 bg-brand-50' : 'text-ink-700'
                }`}
              >
                {kb.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 搜索状态/结果列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {/* 状态行 */}
          <div className="flex items-center justify-between mb-3 text-xs text-ink-500">
            <span>
              {searching
                ? '搜索中…'
                : searched
                ? `找到 ${results.length} 个匹配「${query}」的笔记`
                : '请输入关键词开始检索'}
            </span>
            {searched && !searching && (
              <span className="text-ink-400">在「{activeKb?.name}」中搜索</span>
            )}
          </div>

          {/* 结果列表 */}
          {results.length === 0 && searched && !searching ? (
            <div className="flex flex-col items-center justify-center py-16 text-ink-400">
              <Icon name="search" className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">未找到匹配的笔记</p>
              <p className="text-xs mt-1">试试调整关键词或切换知识库</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {results.map((r) => (
                <li
                  key={r.notePath}
                  onClick={() => onOpenResult(r)}
                  className="group p-3 bg-white border border-ink-200 rounded-lg cursor-pointer hover:border-brand-400 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      name="document"
                      className="w-5 h-5 text-ink-400 group-hover:text-brand-500 flex-shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-ink-800 group-hover:text-brand-600 truncate">
                          {r.noteName.replace(/\.md$/i, '')}
                        </span>
                        {/* 匹配类型徽章 */}
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            r.matchType === 'title'
                              ? 'bg-brand-50 text-brand-600'
                              : r.matchType === 'tag'
                              ? 'bg-yellow-50 text-yellow-700'
                              : 'bg-ink-100 text-ink-500'
                          }`}
                        >
                          {r.matchType === 'title'
                            ? '标题'
                            : r.matchType === 'tag'
                            ? '标签'
                            : r.matchType === 'link'
                            ? '链接'
                            : '正文'}
                        </span>
                      </div>
                      {r.snippet && (
                        <div
                          className="text-xs text-ink-500 line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: r.snippet }}
                        />
                      )}
                      <div className="text-[10px] text-ink-400 mt-1 font-mono">
                        {r.notePath}
                      </div>
                    </div>
                    <Icon
                      name="chevron-right"
                      className="w-4 h-4 text-ink-300 group-hover:text-brand-500 flex-shrink-0"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
