// 左侧面板：目录/标签/笔记列表视图
// 顶部：视图切换（📁🏷📝）+ ⮜ 收起左栏 - 左侧顶部操作栏
// 中部：视图内容
//   - 知识库视图（tree）：FileTree（含内部顶部快捷操作栏）
//   - 标签视图（tags）：TagsView
//   - 笔记列表视图（notes）：NotesListView
import { useState, useEffect, useRef, useCallback } from 'react';
import type { NoteInfo } from '@shared/types';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore, TreeView, SortMode } from '../stores/layout-store';
import { FileTree } from './FileTree';
import { Icon, IconName } from './Icon';

const viewTabs: { id: TreeView; icon: IconName; label: string }[] = [
  { id: 'tree', icon: 'folder', label: '知识库' },
  { id: 'notes', icon: 'queue-list', label: '笔记列表' },
  { id: 'tags', icon: 'tag', label: '标签' }
];

export function LeftPanel() {
  const { tree, activeKb, setActiveKb, setTree, setApplied, pushToast, setKBs } = useKBStore();
  const {
    treeView, setTreeView,
    openTab, leftPanelWidth, setLeftPanelWidth, toggleLeftPanel
  } = useLayoutStore();
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      setLeftPanelWidth(e.clientX - 56);
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
  }, [resizing, setLeftPanelWidth]);

  async function handleAddKb() {
    const kb = await window.forge.kb.add();
    if (kb) {
      setKBs(await window.forge.kb.list());
      setActiveKb(kb);
      const t = await window.forge.fs.listTree(kb.id);
      setTree(t);
      const applied = await window.forge.template.applied(kb.id);
      setApplied(applied);
      pushToast({ level: 'success', text: `已添加知识库：${kb.name}` });
    }
  }

  // 视图切换按钮组（左侧顶部操作栏）
  // fixed 定位覆盖整个窗口顶部，宽度 = MainMenuRail(56) + LeftPanel 宽度，
  // 从最左贯穿到左栏右边缘，让 macOS 红黄绿按钮浮在其上（bg-toolbar 同色）。
  // pl-[72px] 让出 macOS 红黄绿按钮的横向间距（与统一标题栏一致）。
  // 支持双击放大/还原、按住拖动（Electron -webkit-app-region: drag）。
  function ViewTabs() {
    return (
      <div
        className="fixed top-0 left-0 z-20 h-12 flex items-center border-b border-border-soft bg-toolbar pr-2 gap-1 text-xs"
        style={{
          width: 56 + leftPanelWidth,
          paddingLeft: 72,
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
        onDoubleClick={() => window.forge?.win?.maximizeToggle().catch(() => {})}
      >
        <div
          className="flex-1 flex items-center gap-1 min-w-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {viewTabs.map((t) => {
            const active = treeView === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTreeView(t.id)}
                className={`h-7 w-8 flex items-center justify-center rounded-xl transition-colors ${
                  active ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:bg-hover-bg'
                }`}
                title={t.label}
              >
                <Icon name={t.icon} className="w-4 h-4" />
              </button>
            );
          })}
        </div>
        <button
          onClick={toggleLeftPanel}
          className="h-7 w-7 flex items-center justify-center rounded-md text-fg-muted hover:bg-hover-bg hover:text-fg-secondary"
          title="收起侧栏"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Icon name="chevron-left" className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!activeKb) {
    return (
      <aside style={{ width: leftPanelWidth }} className="border-r border-border-soft bg-panel flex flex-col">
        <div className="flex-1 flex items-center justify-center text-fg-muted text-sm p-4 text-center">
          请先在「首页」选择文件夹，开启我的知识库
        </div>
        <div className="h-9 border-t border-border-soft flex items-center px-2">
          <button onClick={handleAddKb} className="btn btn-primary text-xs w-full">＋ 新建知识库</button>
        </div>
        <ResizeHandle onStart={() => setResizing(true)} />
      </aside>
    );
  }

  return (
    <aside
      style={{ width: leftPanelWidth }}
      className="border-r border-border-soft bg-panel flex flex-col relative pt-12"
    >
      <ViewTabs />
      <div className="flex-1 overflow-y-auto">
        {treeView === 'tree' && tree ? (
          <FileTree node={tree} onOpenNote={(p) => openTab(p)} />
        ) : treeView === 'tags' ? (
          <TagsView />
        ) : (
          <NotesListView />
        )}
      </div>
      <ResizeHandle onStart={() => setResizing(true)} />
    </aside>
  );
}

function ResizeHandle({ onStart }: { onStart: () => void }) {
  return (
    <div
      onMouseDown={onStart}
      className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-brand/30"
      title="拖动调整宽度"
    />
  );
}

function TagsView() {
  const { activeKb } = useKBStore();
  const setSelectedTag = useLayoutStore((s) => s.setSelectedTag);
  const setMainView = useLayoutStore((s) => s.setMainView);
  const selectedTag = useLayoutStore((s) => s.selectedTag);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!activeKb) return;
    setLoading(true);
    (async () => {
      try {
        const list = await window.forge.fs.listTags(activeKb.id);
        setTags(list);
      } catch {
        setTags([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeKb]);

  if (loading) {
    return <div className="p-3 text-fg-muted text-sm">加载标签中…</div>;
  }
  if (tags.length === 0) {
    return <div className="p-3 text-fg-muted text-sm">暂无标签（笔记中使用 #标签 自动收集）</div>;
  }

  // 按标签首字符分组（通讯录式索引）
  const groups = new Map<string, { tag: string; count: number }[]>();
  for (const t of tags) {
    const key = (t.tag.trim().charAt(0) || '#').toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  const scrollTo = (key: string) => {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="h-full overflow-y-auto pb-2 pl-2 pr-7">
        {keys.map((key) => (
          <div
            key={key}
            ref={(el) => {
              sectionRefs.current[key] = el;
            }}
            className="pt-1"
          >
            <div className="sticky top-0 z-10 bg-panel/95 backdrop-blur px-2 py-1.5 text-[11px] font-semibold text-fg-muted tracking-wide">
              {key}
            </div>
            {groups.get(key)!.map((t) => {
              const active = selectedTag === t.tag;
              return (
                <div
                  key={t.tag}
                  onClick={() => {
                    setSelectedTag(t.tag);
                    setMainView('tag-notes');
                  }}
                  className={`relative flex items-center gap-2 rounded-xl px-3 py-2 mb-1 cursor-pointer transition-colors text-sm ${
                    active
                      ? 'bg-brand-soft/40 text-brand'
                      : 'text-fg-secondary hover:bg-hover-bg'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand" />
                  )}
                  <Icon
                    name="tag"
                    className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-brand' : 'text-fg-muted'}`}
                  />
                  <span className="flex-1 truncate">#{t.tag}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-hover-bg text-fg-faint">
                    {t.count}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* 右侧索引条：字母自适应均分容器高度，避免字母过多时被裁；z-20 保证浮在滚动内容之上 */}
      <div className="absolute top-2 bottom-2 right-1.5 z-20 flex flex-col items-center text-[10px] text-fg-faint select-none">
        {keys.map((key) => (
          <button
            key={key}
            onClick={() => scrollTo(key)}
            className="w-5 flex-1 min-h-[18px] leading-none opacity-50 hover:opacity-100 hover:text-brand hover:bg-hover-bg rounded-md transition-colors"
            title={key}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

function NotesListView() {
  const { activeKb } = useKBStore();
  const { openTab, setMainView } = useLayoutStore();
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  // 笔记列表视图独立排序，默认按修改时间倒序
  const [listSort, setListSort] = useState<SortMode>('mtime');

  const loadNotes = useCallback(async () => {
    if (!activeKb) return;
    setLoading(true);
    try {
      const list = await window.forge.fs.listNotes(activeKb.id, listSort);
      setNotes(list);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [activeKb, listSort]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // 文件变更后刷新列表
  useEffect(() => {
    const off = window.forge.events.onFsChange(() => loadNotes());
    return () => off();
  }, [loadNotes]);

  const sortOptions: { v: SortMode; l: string }[] = [
    { v: 'mtime', l: '修改时间' },
    { v: 'name', l: '名称' }
  ];
  const activeSort = listSort === 'created' ? 'mtime' : listSort;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部排序栏 */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-border-soft bg-toolbar text-xs shrink-0">
        <span className="text-fg-muted">共 {notes.length} 篇</span>
        <div className="flex items-center gap-1">
          {sortOptions.map((s) => (
            <button
              key={s.v}
              onClick={() => setListSort(s.v)}
              className={`px-2 py-1 rounded-md transition-colors ${
                activeSort === s.v
                  ? 'bg-brand-soft text-brand'
                  : 'text-fg-muted hover:bg-hover-bg'
              }`}
              title={`按${s.l}排序`}
            >
              {s.l}
            </button>
          ))}
        </div>
      </div>

      {/* 笔记列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="p-4 text-fg-muted text-sm text-center">加载笔记中…</div>
        ) : notes.length === 0 ? (
          <div className="p-4 text-fg-muted text-sm text-center">
            暂无笔记
          </div>
        ) : (
          <div className="space-y-1">
            {notes.map((n) => (
              <button
                key={n.path}
                onClick={() => {
                  openTab(n.path);
                  setMainView('note');
                }}
                className="w-full text-left rounded-xl px-3 py-2 hover:bg-hover-bg transition-colors group"
                title={n.path}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    name="document"
                    className="w-4 h-4 text-fg-muted shrink-0 mt-0.5 group-hover:text-brand"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-fg truncate">
                      {n.name.replace(/\.md$/i, '')}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-fg-faint">
                      <span className="truncate">{n.dirPath || '根目录'}</span>
                      <span>·</span>
                      <span>{new Date(n.mtime).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

