import { useState, useEffect, useMemo } from 'react';
import type { TreeNode } from '@shared/types';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore, SortMode } from '../stores/layout-store';
import { Icon } from './Icon';

interface Props {
  node: TreeNode;
  depth?: number;
  onOpenNote: (path: string) => void;
}

function sortNodes(nodes: TreeNode[] | undefined, mode: SortMode): TreeNode[] {
  if (!nodes) return [];
  const dirs = nodes.filter((n) => n.kind === 'dir');
  const files = nodes.filter((n) => n.kind !== 'dir');
  const cmp = (a: TreeNode, b: TreeNode) => {
    if (mode === 'mtime' || mode === 'created') {
      const av = a.mtime ?? 0;
      const bv = b.mtime ?? 0;
      return bv - av;
    }
    // name: 中文 + 英文
    return a.name.localeCompare(b.name, 'zh-CN');
  };
  return [...dirs.sort(cmp), ...files.sort(cmp)];
}

export function FileTree({ node, depth = 0, onOpenNote }: Props) {
  const { activeKb, pushToast, setTree, openCreateNote } = useKBStore();
  const { sortMode } = useLayoutStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 目录重命名 / 新建后内联编辑态：{ path, name }
  const [editing, setEditing] = useState<{ path: string; name: string } | null>(null);

  // 新建目录（根或子目录），初始名“未命名目录”，创建后自动进入重命名态
  const handleCreateDir = async (parentPath: string) => {
    if (!activeKb) return;
    try {
      const newPath = await window.forge.fs.createDir(activeKb.id, parentPath, '未命名目录');
      const t = await window.forge.fs.listTree(activeKb.id);
      setTree(t);
      // 展开并进入重命名
      setExpanded((s) => new Set([...s, parentPath]));
      setEditing({ path: newPath, name: '未命名目录' });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  };

  // 确认重命名
  const commitRename = async () => {
    if (!editing || !activeKb) {
      setEditing(null);
      return;
    }
    const name = editing.name.trim();
    const oldPath = editing.path;
    setEditing(null);
    if (!name) return;
    const curName = oldPath.includes('/') ? oldPath.slice(oldPath.lastIndexOf('/') + 1) : oldPath;
    if (name === curName) return; // 未变化
    try {
      await window.forge.fs.renameDir(activeKb.id, oldPath, name);
      const t = await window.forge.fs.listTree(activeKb.id);
      setTree(t);
    } catch (err) {
      pushToast({ level: 'error', text: String(err) });
    }
  };

  useEffect(() => {
    if (depth === 0) setExpanded((s) => new Set([...s, node.id]));
  }, [node.id, depth]);

  // 监听全局折叠/展开/排序事件
  useEffect(() => {
    function onCollapseAll() {
      if (depth === 0) setExpanded(new Set([node.id]));
    }
    function onExpandAll() {
      if (depth === 0) {
        // 展开所有目录
        const allDirs = new Set<string>();
        const walk = (n: TreeNode) => {
          if (n.kind === 'dir' || n.kind === 'kb_root') allDirs.add(n.id);
          n.children?.forEach(walk);
        };
        walk(node);
        setExpanded(allDirs);
      }
    }
    window.addEventListener('forgenote:collapseAll', onCollapseAll);
    window.addEventListener('forgenote:expandAll', onExpandAll);
    return () => {
      window.removeEventListener('forgenote:collapseAll', onCollapseAll);
      window.removeEventListener('forgenote:expandAll', onExpandAll);
    };
  }, [node, depth]);

  const sortedChildren = useMemo(
    () => sortNodes(node.children, sortMode),
    [node.children, sortMode]
  );

  if (node.kind === 'kb_root') {
    return (
      <div data-tree>
        {/* 视图内顶部快捷操作栏：新建笔记 / 新建目录 / 排序 / 折叠 / 展开
            （属于知识库视图内的快捷操作，不占用 LeftPanel 顶部） */}
        <div className="h-9 flex items-center border-b border-border-soft bg-toolbar text-xs">
          <button
            onClick={() => openCreateNote()}
            className="h-full w-9 flex items-center justify-center border-r border-border-soft text-fg-secondary hover:bg-hover-bg"
            title="新建笔记"
          ><Icon name="document-plus" className="w-4 h-4" /></button>
          <button
            onClick={() => handleCreateDir('')}
            className="h-full w-9 flex items-center justify-center border-r border-border-soft text-fg-secondary hover:bg-hover-bg"
            title="新建目录"
          ><Icon name="folder-plus" className="w-4 h-4" /></button>
          <div className="relative group">
            <button
              className="h-full w-9 flex items-center justify-center border-r border-border-soft text-fg-secondary hover:bg-hover-bg"
              title="排序方式"
            ><Icon name="arrows-up-down" className="w-4 h-4" /></button>
            <div className="absolute left-0 top-full mt-1 bg-content border border-border-soft rounded shadow-lg z-30 hidden group-hover:block min-w-[120px]">
              {([
                { v: 'name', l: '按名称' },
                { v: 'mtime', l: '按修改时间' },
                { v: 'created', l: '按创建时间' }
              ] as { v: SortMode; l: string }[]).map((s) => (
                <button
                  key={s.v}
                  onClick={() => {
                    useLayoutStore.getState().setSortMode(s.v);
                    window.dispatchEvent(new CustomEvent('forgenote:sort', { detail: s.v }));
                  }}
                  className={`block w-full text-left px-3 py-1 hover:bg-hover-bg ${
                    sortMode === s.v ? 'text-brand font-medium' : 'text-fg-secondary'
                  }`}
                >
                  {s.l}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('forgenote:collapseAll'))}
            className="h-full w-9 flex items-center justify-center border-r border-border-soft text-fg-secondary hover:bg-hover-bg"
            title="全部折叠"
          ><Icon name="chevron-up" className="w-4 h-4" /></button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('forgenote:expandAll'))}
            className="h-full w-9 flex items-center justify-center border-r border-border-soft text-fg-secondary hover:bg-hover-bg"
            title="全部展开"
          ><Icon name="chevron-down" className="w-4 h-4" /></button>
        </div>
        {sortedChildren.map((c) => (
          <FileTree key={c.id} node={c} depth={depth} onOpenNote={onOpenNote} />
        ))}
      </div>
    );
  }

  if (node.kind === 'dir') {
    const isOpen = expanded.has(node.id);
    const indent = { paddingLeft: 8 + depth * 12 };
    return (
      <div>
        <div
          className="group flex items-center gap-1 py-0.5 pr-2 hover:bg-hover-bg text-sm cursor-pointer"
          style={indent}
          onClick={() => {
            const ns = new Set(expanded);
            if (isOpen) ns.delete(node.id);
            else ns.add(node.id);
            setExpanded(ns);
          }}
        >
          <Icon
            name={isOpen ? 'chevron-down' : 'chevron-right'}
            className="w-3 h-3 text-fg-muted shrink-0"
          />
          <Icon name="folder" className="w-4 h-4 text-fg-muted shrink-0" solid={node.templateDirId === '00'} />
          {editing?.path === node.path ? (
            <input
              autoFocus
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(null);
                }
              }}
              className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-brand rounded outline-none bg-content"
            />
          ) : (
            <span
              className="truncate flex-1"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing({ path: node.path, name: node.name });
              }}
              title="双击重命名"
            >
              {node.name}
            </span>
          )}
          {node.templateDirId === '00' && (node.noteCount || 0) > 0 && (
            <span className="badge badge-brand">{node.noteCount}</span>
          )}
          {node.templateDirId && node.templateDirId !== '00' && (
            <span className="badge badge-gray text-[10px]">{node.noteCount || 0}</span>
          )}
          <button
            className="icon-btn opacity-0 group-hover:opacity-100 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              if (activeKb) openCreateNote(node.path);
            }}
            title="在此目录新建笔记"
          >
            <Icon name="document-plus" className="w-3.5 h-3.5" />
          </button>
          <button
            className="icon-btn opacity-0 group-hover:opacity-100 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateDir(node.path);
            }}
            title="新建子目录"
          >
            <Icon name="folder-plus" className="w-3.5 h-3.5" />
          </button>
        </div>
        {isOpen && (
          <div>
            {sortedChildren.map((c) => (
              <FileTree key={c.id} node={c} depth={depth + 1} onOpenNote={onOpenNote} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // file
  const indent = { paddingLeft: 8 + depth * 12 + 12 };
  const fileName = node.name.replace(/\.md$/i, '');
  return (
    <div
      className="group flex items-center gap-1 py-0.5 pr-2 hover:bg-hover-bg text-sm cursor-pointer"
      style={indent}
      onClick={() => onOpenNote(node.path)}
      title={node.path}
    >
      <Icon name="document" className="w-4 h-4 text-fg-muted shrink-0" />
      <span className="truncate flex-1">{fileName}</span>
      <button
        className="icon-btn opacity-0 group-hover:opacity-100 text-xs"
        onClick={async (e) => {
          e.stopPropagation();
          if (!activeKb) return;
          if (!confirm(`确定删除「${fileName}」？`)) return;
          try {
            await window.forge.fs.deleteNote(activeKb.id, node.path);
            const t = await window.forge.fs.listTree(activeKb.id);
            setTree(t);
          } catch (err) {
            pushToast({ level: 'error', text: String(err) });
          }
        }}
        title="删除"
      >
        <Icon name="trash" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
