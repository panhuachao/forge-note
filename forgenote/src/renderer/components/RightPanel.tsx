// 右侧属性/大纲面板
// 顶部行 1：文章的额外信息项（4 个 AI 操作图标）
// 顶部行 2：搜索 / 大纲 双标签 + 更多 + 关闭
import { useState, useEffect, useCallback } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { LinkPanel } from './LinkPanel';
import { NoteOutline } from './NoteOutline';
import { AISuggestionPanel } from './AISuggestionPanel';
import { SearchPanel } from './SearchPanel';
import { Icon, IconName } from './Icon';

type RightTab = 'outline' | 'search';

export function RightPanel() {
  const { rightPanelWidth, setRightPanelWidth, toggleRightPanel, tabs, activeTabId } = useLayoutStore();
  const { activeKb } = useKBStore();
  const [resizing, setResizing] = useState(false);
  const [tab, setTab] = useState<RightTab>('outline');
  const [info, setInfo] = useState<any>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const notePath = activeTab?.notePath || null;

  useEffect(() => {
    const id = setInterval(() => {
      const data = (window as any).__forgeNoteData;
      if (data !== info) setInfo(data);
    }, 250);
    return () => clearInterval(id);
  }, [info]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      setRightPanelWidth(window.innerWidth - e.clientX);
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, setRightPanelWidth]);

  // 触发 AI 动作
  const handleAIAction = useCallback(async (action: 'summarize' | 'links' | 'dir' | 'forge') => {
    const actions = (window as any).__forgeNoteActions;
    if (!actions || !notePath) return;
    try {
      await actions[action](notePath);
    } catch (e) {
      console.error(e);
    }
  }, [notePath]);

  const aiActions: { id: 'summarize' | 'links' | 'dir' | 'forge'; icon: IconName; title: string }[] = [
    { id: 'summarize', icon: 'pencil', title: 'AI 摘要' },
    { id: 'links', icon: 'link', title: 'AI 链接推荐' },
    { id: 'dir', icon: 'folder', title: 'AI 归纳推荐' },
    { id: 'forge', icon: 'sparkles', title: '锻造知识卡片' }
  ];

  return (
    <aside
      style={{ width: rightPanelWidth }}
      className="border-l border-ink-200 bg-white flex flex-col relative"
    >
      {/* 行 1：文章的额外信息项（4 个 AI 操作图标） */}
      <div className="h-8 flex items-center border-b border-ink-200 bg-white text-xs">
        {aiActions.map((a) => (
          <button
            key={a.id}
            onClick={() => handleAIAction(a.id)}
            disabled={!notePath}
            className={`h-full w-8 flex items-center justify-center border-r border-ink-200 ${
              notePath ? 'text-ink-600 hover:bg-ink-100' : 'text-ink-300 cursor-not-allowed'
            }`}
            title={a.title}
          >
            <Icon name={a.icon} className="w-4 h-4" />
          </button>
        ))}
        <div className="flex-1" />
        <button
          className="h-full w-8 flex items-center justify-center text-ink-400 hover:bg-ink-100 text-base"
          title="更多"
        ><Icon name="ellipsis" className="w-4 h-4" /></button>
      </div>

      {/* 行 2：搜索 / 大纲 双标签 + 关闭 */}
      <div className="flex items-center h-8 bg-ink-50 border-b border-ink-200 text-xs">
        <button
          onClick={() => setTab('outline')}
          className={`h-full px-3 flex items-center gap-1 border-r border-ink-200 ${
            tab === 'outline' ? 'bg-white text-ink-900 font-medium' : 'text-ink-600 hover:bg-white/50'
          }`}
          title="大纲 / 属性"
        >
          <Icon name="queue-list" className="w-4 h-4" /> 大纲
        </button>
        <button
          onClick={() => setTab('search')}
          className={`h-full px-3 flex items-center gap-1 border-r border-ink-200 ${
            tab === 'search' ? 'bg-white text-ink-900 font-medium' : 'text-ink-600 hover:bg-white/50'
          }`}
          title="搜索"
        >
          <Icon name="search" className="w-4 h-4" /> 搜索
        </button>
        <div className="flex-1" />
        <button
          onClick={toggleRightPanel}
          className="h-full w-8 flex items-center justify-center text-ink-500 hover:bg-ink-100"
          title="收起"
        >
          <Icon name="chevron-right" className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'outline' ? (
          info && activeKb ? (
            <>
              <NoteOutline
                content={info.currentInfo?.content || ''}
                onJump={() => {}}
              />
              <LinkPanel
                kbId={activeKb.id}
                notePath={info.notePath || ''}
                inlinks={info.currentInfo?.inlinks || []}
                outlinks={info.currentInfo?.outlinks || []}
                broken={info.currentInfo?.brokenLinks || []}
                onOpen={(p) => {
                  useLayoutStore.getState().openTab(p);
                }}
              />
              {(info.linkSuggestions?.length > 0 ||
                info.dirSuggestions?.length > 0 ||
                info.summary) && (
                <AISuggestionPanel
                  linkSuggestions={info.linkSuggestions || []}
                  dirSuggestions={info.dirSuggestions || []}
                  summary={info.summary}
                  onApplyLinks={(targets) => info.onApplyLinks?.(info.notePath, targets)}
                  onApplyDir={(dir) => info.onApplyDir?.(info.notePath, dir)}
                  onCloseSummary={info.onCloseSummary || (() => {})}
                />
              )}
            </>
          ) : (
            <div className="text-center text-ink-400 text-sm py-8 px-3">
              选择一篇笔记查看属性
            </div>
          )
        ) : (
          <div className="p-2">
            <SearchPanel />
          </div>
        )}
      </div>
      <div
        onMouseDown={() => setResizing(true)}
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-brand-400/30"
        title="拖动调整宽度"
      />
    </aside>
  );
}
