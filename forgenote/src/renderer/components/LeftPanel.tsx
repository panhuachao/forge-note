// 左侧面板：目录/搜索/标签视图
// 顶部（h-9）：视图切换（📁🔍🏷）+ ⮜ 收起左栏 - 左侧顶部操作栏
// 中部：视图内容
//   - 知识库视图（tree）：FileTree（含内部顶部快捷操作栏）
//   - 搜索视图（search）：SearchPanel
//   - 标签视图（tags）：TagsView
import { useState, useEffect } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore, TreeView } from '../stores/layout-store';
import { FileTree } from './FileTree';
import { SearchPanel } from './SearchPanel';
import { Icon, IconName } from './Icon';

const viewTabs: { id: TreeView; icon: IconName; label: string }[] = [
  { id: 'tree', icon: 'folder', label: '知识库' },
  { id: 'search', icon: 'search', label: '搜索' },
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
  // pl-[72px] 让出 macOS 红黄绿按钮的横向区域，避免与视图切换按钮重叠
  function ViewTabs() {
    return (
      <div className="h-10 flex items-center border-b border-border-soft bg-toolbar pl-[72px] pr-2 gap-1 text-xs">
        <div className="flex-1 flex items-center gap-1 min-w-0">
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
      className="border-r border-border bg-panel flex flex-col relative"
    >
      <ViewTabs />
      <div className="flex-1 overflow-y-auto">
        {treeView === 'tree' && tree ? (
          <FileTree node={tree} onOpenNote={(p) => openTab(p)} />
        ) : treeView === 'search' ? (
          <div className="p-2">
            <SearchPanel />
          </div>
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
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeKb) return;
    setLoading(true);
    (async () => {
      try {
        const tree = await window.forge.fs.listTree(activeKb.id);
        // 递归收集所有笔记路径
        const paths: string[] = [];
        const walk = (n: any) => {
          if (!n) return;
          if (n.kind === 'note' && n.path) paths.push(n.path);
          if (Array.isArray(n.children)) n.children.forEach(walk);
        };
        walk(tree);
        const counter: Record<string, number> = {};
        for (const p of paths) {
          try {
            const note = await window.forge.fs.readNote(activeKb.id, p);
            const matches = note.content.match(/(?:^|\s)#([\p{L}\p{N}_\-]+)/gu) || [];
            for (const m of matches) {
              const t = m.trim().replace(/^#/, '');
              if (t) counter[t] = (counter[t] || 0) + 1;
            }
          } catch {}
        }
        const list = Object.entries(counter)
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count);
        setTags(list);
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
  return (
    <div className="py-1">
      {tags.map((t) => (
        <div
          key={t.tag}
          onClick={() => {
            // 触发搜索视图并预填标签
            useLayoutStore.getState().setTreeView('search');
            window.dispatchEvent(new CustomEvent('forgenote:search', { detail: `#${t.tag}` }));
          }}
          className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-hover-bg text-sm"
        >
          <Icon name="tag" className="w-4 h-4 text-fg-muted" />
          <span className="flex-1 truncate">#{t.tag}</span>
          <span className="text-fg-faint text-xs">{t.count}</span>
        </div>
      ))}
    </div>
  );
}

