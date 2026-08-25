// 左侧面板：目录/搜索/标签视图
// 顶部（高 32px）：快捷操作栏（视图切换/新建笔记/新建目录/排序/全部折叠/全部展开/收起）
// 中部：树/搜索/标签内容
import { useState, useEffect } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore, SortMode } from '../stores/layout-store';
import { FileTree } from './FileTree';
import { SearchPanel } from './SearchPanel';

export function LeftPanel() {
  const { tree, activeKb, kbs, setActiveKb, setTree, setApplied, pushToast, openCreateNote, setKBs } = useKBStore();
  const {
    treeView, setTreeView,
    openTab, leftPanelWidth, setLeftPanelWidth,
    sortMode, setSortMode,
    toggleLeftPanel
  } = useLayoutStore();
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      setLeftPanelWidth(e.clientX - 48);
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

  async function handleNewDir() {
    if (!activeKb) return;
    const name = prompt('新建目录名称', '新文件夹');
    if (!name) return;
    try {
      await window.forge.fs.createDir(activeKb.id, '', name);
      const t = await window.forge.fs.listTree(activeKb.id);
      setTree(t);
      pushToast({ level: 'success', text: `已创建目录：${name}` });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }

  function emitSort(mode: SortMode) {
    setSortMode(mode);
    window.dispatchEvent(new CustomEvent('forgenote:sort', { detail: mode }));
  }
  function emitCollapseAll() {
    window.dispatchEvent(new CustomEvent('forgenote:collapseAll'));
  }
  function emitExpandAll() {
    window.dispatchEvent(new CustomEvent('forgenote:expandAll'));
  }

  if (!activeKb) {
    return (
      <aside style={{ width: leftPanelWidth }} className="border-r border-ink-200 bg-white flex flex-col">
        <LeftToolbar
          treeView={treeView}
          setTreeView={setTreeView}
          onAddNote={() => openCreateNote()}
          onAddDir={handleNewDir}
          onSort={emitSort}
          sortMode={sortMode}
          onCollapseAll={emitCollapseAll}
          onExpandAll={emitExpandAll}
          onClose={toggleLeftPanel}
        />
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm p-4 text-center">
          请先在「首页」选择文件夹，开启我的知识库
        </div>
        <div className="h-9 border-t border-ink-200 flex items-center px-2">
          <button onClick={handleAddKb} className="btn btn-primary text-xs w-full">＋ 新建知识库</button>
        </div>
        <ResizeHandle onStart={() => setResizing(true)} />
      </aside>
    );
  }

  return (
    <aside
      style={{ width: leftPanelWidth }}
      className="border-r border-ink-200 bg-white flex flex-col relative"
    >
      <LeftToolbar
        treeView={treeView}
        setTreeView={setTreeView}
        onAddNote={() => openCreateNote()}
        onAddDir={handleNewDir}
        onSort={emitSort}
        sortMode={sortMode}
        onCollapseAll={emitCollapseAll}
        onExpandAll={emitExpandAll}
        onClose={toggleLeftPanel}
      />

      <div className="flex-1 overflow-y-auto py-1">
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

// 左侧快捷操作栏（顶部）
function LeftToolbar({
  treeView, setTreeView,
  onAddNote, onAddDir, onSort, sortMode,
  onCollapseAll, onExpandAll,
  onClose
}: {
  treeView: 'tree' | 'search' | 'tags';
  setTreeView: (v: 'tree' | 'search' | 'tags') => void;
  onAddNote: () => void;
  onAddDir: () => void;
  onSort: (mode: SortMode) => void;
  sortMode: SortMode;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onClose: () => void;
}) {
  return (
    <div className="h-8 flex items-center border-b border-ink-200 bg-white text-xs">
      {/* 视图切换：知识库 / 搜索 / 标签 */}
      <div className="flex items-center h-full">
        <button
          onClick={() => setTreeView('tree')}
          className={`h-full w-8 flex items-center justify-center border-r border-ink-200 ${
            treeView === 'tree' ? 'bg-ink-100 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
          }`}
          title="知识库目录"
        >📁</button>
        <button
          onClick={() => setTreeView('search')}
          className={`h-full w-8 flex items-center justify-center border-r border-ink-200 ${
            treeView === 'search' ? 'bg-ink-100 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
          }`}
          title="搜索"
        >🔍</button>
        <button
          onClick={() => setTreeView('tags')}
          className={`h-full w-8 flex items-center justify-center border-r border-ink-200 ${
            treeView === 'tags' ? 'bg-ink-100 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
          }`}
          title="标签"
        >🏷</button>
      </div>
      {/* 快捷操作 */}
      <button
        onClick={onAddNote}
        className="h-full w-8 flex items-center justify-center border-r border-ink-200 text-ink-600 hover:bg-ink-100"
        title="新建笔记"
      >✎</button>
      <button
        onClick={onAddDir}
        className="h-full w-8 flex items-center justify-center border-r border-ink-200 text-ink-600 hover:bg-ink-100"
        title="新建目录"
      >📁＋</button>
      <div className="relative group">
        <button
          className="h-full w-8 flex items-center justify-center border-r border-ink-200 text-ink-600 hover:bg-ink-100"
          title="排序方式"
        >↕</button>
        <div className="absolute left-0 top-full mt-1 bg-white border border-ink-200 rounded shadow-lg z-30 hidden group-hover:block min-w-[120px]">
          {([
            { v: 'name', l: '按名称' },
            { v: 'mtime', l: '按修改时间' },
            { v: 'created', l: '按创建时间' }
          ] as { v: SortMode; l: string }[]).map((s) => (
            <button
              key={s.v}
              onClick={() => onSort(s.v)}
              className={`block w-full text-left px-3 py-1 hover:bg-ink-100 ${
                sortMode === s.v ? 'text-brand-600 font-medium' : 'text-ink-700'
              }`}
            >
              {s.l}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={onCollapseAll}
        className="h-full w-8 flex items-center justify-center border-r border-ink-200 text-ink-600 hover:bg-ink-100"
        title="全部折叠"
      >⊟</button>
      <button
        onClick={onExpandAll}
        className="h-full w-8 flex items-center justify-center border-r border-ink-200 text-ink-600 hover:bg-ink-100"
        title="全部展开"
      >⊞</button>
      <div className="flex-1" />
      <button
        onClick={onClose}
        className="h-full w-8 flex items-center justify-center text-ink-500 hover:bg-ink-100 text-sm"
        title="收起侧栏"
      >⮞</button>
    </div>
  );
}

function ResizeHandle({ onStart }: { onStart: () => void }) {
  return (
    <div
      onMouseDown={onStart}
      className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-brand-400/30"
      title="拖动调整宽度"
    />
  );
}

function TagsView() {
  const { activeKb } = useKBStore();
  const { openTab } = useLayoutStore();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeKb) return;
    setLoading(true);
    (async () => {
      try {
        const tree = await window.forge.fs.listTree(activeKb.id);
        const allFiles: string[] = [];
        const walk = (n: any) => {
          if (n.kind === 'file' && n.name.endsWith('.md')) allFiles.push(n.path);
          n.children?.forEach(walk);
        };
        walk(tree);
        const tagMap = new Map<string, number>();
        for (const p of allFiles) {
          const c = await window.forge.fs.readText(activeKb.id, p).catch(() => '');
          const matches = c.match(/(?:^|\s)#([\u4e00-\u9fa5\w-]+)/g) || [];
          for (const m of matches) {
            const t = m.trim().replace(/^#/, '');
            if (t) tagMap.set(t, (tagMap.get(t) || 0) + 1);
          }
        }
        setTags(
          [...tagMap.entries()]
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count)
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [activeKb?.id]);

  if (loading) return <div className="text-center text-ink-400 text-xs py-4">加载中…</div>;
  if (tags.length === 0)
    return (
      <div className="text-center text-ink-400 text-xs py-4 px-3">
        暂无标签
        <div className="mt-1 text-[10px]">在笔记中用 #标签 创建</div>
      </div>
    );
  return (
    <div className="px-3 py-2 space-y-0.5">
      {tags.map((t) => (
        <div
          key={t.tag}
          className="flex items-center justify-between px-2 py-1 rounded hover:bg-ink-100 text-sm cursor-pointer"
          onClick={async () => {
            const r = await window.forge.search.query(activeKb!.id, `#${t.tag}`);
            if (r[0]) openTab(r[0].notePath);
          }}
        >
          <span>#{t.tag}</span>
          <span className="text-xs text-ink-400">{t.count}</span>
        </div>
      ))}
    </div>
  );
}
