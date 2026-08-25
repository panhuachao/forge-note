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
    <div className="flex-1 flex flex-col bg-content overflow-hidden">
      {/* 顶部：返回 + 搜索栏 + 知识库
          与统一标题栏一致：fixed 定位覆盖整个窗口顶部，border-b 贯通 MainMenuRail 至右栏 */}
      <div className="fixed top-0 left-0 right-0 z-20 h-14 pl-[72px] pr-4 flex items-center gap-3 border-b border-border bg-toolbar">
        <button
          onClick={() => setMainView('home')}
          className="w-8 h-8 flex items-center justify-center text-fg-muted hover:bg-hover-bg rounded-lg flex-shrink-0"
          title="返回首页"
        >
          <Icon name="arrow-left" className="w-4 h-4" />
        </button>

        {/* 搜索输入框（占据主要宽度） */}
        <div className="flex-1 max-w-2xl flex items-center gap-2 px-3 h-9 rounded-lg border border-border bg-canvas focus-within:border-brand focus-within:bg-content transition-colors">
          <Icon name="search" className="w-4 h-4 text-fg-faint flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
            placeholder="在所有笔记中检索关键词…"
            className="flex-1 bg-transparent outline-none text-sm text-fg placeholder:text-fg-faint"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="w-5 h-5 flex items-center justify-center text-fg-faint hover:text-fg-secondary"
              title="清空"
            >
              <Icon name="x-mark" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 知识库切换 */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-panel text-xs text-fg-secondary hover:bg-active-bg">
            <Icon name="folder" className="w-3.5 h-3.5" />
            <span>{activeKb?.name || '未选择'}</span>
            <Icon name="chevron-down" className="w-3 h-3" />
          </button>
          <div className="absolute right-0 top-full mt-1 bg-content border border-border rounded-lg shadow-lg z-30 hidden group-hover:block min-w-[200px]">
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
                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-hover-bg ${
                  activeKb?.id === kb.id ? 'text-fg bg-active-bg' : 'text-fg-secondary'
                }`}
              >
                {kb.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 占位，避免下方内容被 fixed 标题栏遮挡 */}
      <div className="h-14 flex-shrink-0" />

      {/* 搜索状态/结果列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {/* 状态行 */}
          <div className="flex items-center justify-between mb-3 text-xs text-fg-muted">
            <span>
              {searching
                ? '搜索中…'
                : searched
                ? `找到 ${results.length} 个匹配「${query}」的笔记`
                : '请输入关键词开始检索'}
            </span>
            {searched && !searching && (
              <span className="text-fg-faint">在「{activeKb?.name}」中搜索</span>
            )}
          </div>

          {/* 结果列表 */}
          {results.length === 0 && searched && !searching ? (
            <div className="flex flex-col items-center justify-center py-16 text-fg-faint">
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
                  className="group p-3 bg-content border border-border rounded-lg cursor-pointer hover:border-brand hover:shadow-sm transition-all"
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      name="document"
                      className="w-5 h-5 text-fg-faint group-hover:text-brand flex-shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-fg group-hover:text-brand truncate">
                          {r.noteName.replace(/\.md$/i, '')}
                        </span>
                        {/* 匹配类型徽章 */}
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            r.matchType === 'title'
                              ? 'bg-active-bg text-fg-secondary'
                              : r.matchType === 'tag'
                              ? 'bg-yellow-50 text-yellow-700'
                              : 'bg-panel text-fg-muted'
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
                          className="text-xs text-fg-muted line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: r.snippet }}
                        />
                      )}
                      <div className="text-[10px] text-fg-faint mt-1 font-mono">
                        {r.notePath}
                      </div>
                    </div>
                    <Icon
                      name="chevron-right"
                      className="w-4 h-4 text-fg-faint group-hover:text-brand flex-shrink-0"
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
