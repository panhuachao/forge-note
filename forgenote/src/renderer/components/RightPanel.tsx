// 右侧属性/大纲面板
// 顶部：AI 操作（📝🔗📂⚒）+ 大纲 / 搜索 双标签
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
  const { rightPanelWidth, setRightPanelWidth, tabs, activeTabId, toggleRightPanel } = useLayoutStore();
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
      className="border-l border-border bg-panel flex flex-col relative"
    >
      {/* 顶部：AI 操作 + 大纲 / 搜索 双标签 + 收起（最右） */}
      <div className="flex items-center h-10 gap-0.5 px-2 bg-toolbar border-b border-border-soft text-xs">
        {/* AI 操作（左侧） */}
        <div className="flex items-center gap-0.5">
          {aiActions.map((a) => (
            <button
              key={a.id}
              onClick={() => handleAIAction(a.id)}
              disabled={!notePath}
              className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${
                notePath ? 'text-fg-muted hover:bg-hover-bg hover:text-fg-secondary' : 'text-fg-faint cursor-not-allowed'
              }`}
              title={a.title}
            >
              <Icon name={a.icon} className="w-4 h-4" />
            </button>
          ))}
        </div>
        {/* 大纲 / 搜索 双标签（分段控件，浅灰底容器 + 白底凸出选中） */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center h-7 bg-panel rounded-md p-0.5 border border-border-soft">
            <button
              onClick={() => setTab('outline')}
              className={`h-6 px-3 flex items-center gap-1 rounded text-[12px] transition-colors ${
                tab === 'outline' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'
              }`}
              title="大纲 / 属性"
            >
              <Icon name="queue-list" className="w-3.5 h-3.5" /> 大纲
            </button>
            <button
              onClick={() => setTab('search')}
              className={`h-6 px-3 flex items-center gap-1 rounded text-[12px] transition-colors ${
                tab === 'search' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'
              }`}
              title="搜索"
            >
              <Icon name="search" className="w-3.5 h-3.5" /> 搜索
            </button>
          </div>
        </div>
        {/* 收起右栏（最右） */}
        <button
          onClick={toggleRightPanel}
          className="h-7 w-7 flex items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-secondary"
          title="收起属性面板"
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
            <div className="text-center text-fg-muted text-sm py-8 px-3">
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
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-brand/30"
        title="拖动调整宽度"
      />
    </aside>
  );
}
