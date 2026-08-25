// 左侧面板：目录/标签视图
// 顶部：视图切换（📁🏷）+ ⮜ 收起左栏 - 左侧顶部操作栏
// 中部：视图内容
//   - 知识库视图（tree）：FileTree（含内部顶部快捷操作栏）
//   - 标签视图（tags）：TagsView
import { useState, useEffect, useRef } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore, TreeView } from '../stores/layout-store';
import { FileTree } from './FileTree';
import { Icon, IconName } from './Icon';

const viewTabs: { id: TreeView; icon: IconName; label: string }[] = [
  { id: 'tree', icon: 'folder', label: '知识库' },
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
        className="fixed top-0 left-0 z-20 h-14 flex items-center border-b border-border bg-toolbar pr-2 gap-1 text-xs"
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
                className={`h-7 w-8 flex items-center justify-center rounded-md transition-colors ${
                  active ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:bg-hover-bg'
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
      <aside style={{ width: leftPanelWidth }} className="border-r border-border bg-panel flex flex-col">
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
      className="border-r border-border bg-panel flex flex-col relative pt-14"
    >
      <ViewTabs />
      <div className="flex-1 overflow-y-auto">
        {treeView === 'tree' && tree ? (
          <FileTree node={tree} onOpenNote={(p) => openTab(p)} />
        ) : (
          <TagsView />
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
      <div ref={scrollRef} className="h-full overflow-y-auto pb-2">
        {keys.map((key) => (
          <div
            key={key}
            ref={(el) => {
              sectionRefs.current[key] = el;
            }}
          >
            <div className="sticky top-0 z-10 bg-panel/95 backdrop-blur px-3 py-1 text-xs font-semibold text-fg-faint border-b border-border-soft">
              {key}
            </div>
            {groups.get(key)!.map((t) => (
              <div
                key={t.tag}
                onClick={() => {
                  setSelectedTag(t.tag);
                  setMainView('tag-notes');
                }}
                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-hover-bg text-sm ${
                  selectedTag === t.tag ? 'bg-active-bg' : ''
                }`}
              >
                <Icon name="tag" className="w-4 h-4 text-fg-muted" />
                <span className="flex-1 truncate">#{t.tag}</span>
                <span className="text-fg-faint text-xs">{t.count}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* 右侧索引条 */}
      <div className="absolute top-1 right-1 flex flex-col items-center gap-0.5 max-h-full overflow-hidden text-[10px] text-fg-faint select-none">
        {keys.map((key) => (
          <button
            key={key}
            onClick={() => scrollTo(key)}
            className="w-4 h-4 leading-none hover:text-brand hover:bg-hover-bg rounded"
            title={key}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

