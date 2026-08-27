import { useState, useEffect, useMemo } from 'react';
import type { TreeNode } from '@shared/types';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore, SortMode } from '../stores/layout-store';
import { Icon } from './Icon';
import { TREE_CTX_EVENT, type TreeCtxDetail } from './TreeContextMenuRoot';

// 打开文件树右键菜单：派发全局事件，由 App 层的 TreeContextMenuRoot 统一渲染
function openTreeCtxMenu(type: 'file' | 'dir', path: string, name: string, x: number, y: number) {
  const detail: TreeCtxDetail = { x, y, type, path, name };
  window.dispatchEvent(new CustomEvent(TREE_CTX_EVENT, { detail }));
}

interface Props {
  node: TreeNode;
  depth?: number;
  onOpenNote: (path: string) => void;
  // 展开状态由根实例（kb_root）统一持有并向下透传，保证“全部展开/折叠”对所有层级生效
  expanded?: Set<string>;
  setExpanded?: React.Dispatch<React.SetStateAction<Set<string>>>;
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

export function FileTree({ node, depth = 0, onOpenNote, expanded: expandedProp, setExpanded: setExpandedProp }: Props) {
  const { activeKb, pushToast, setTree, openCreateNote } = useKBStore();
  const { sortMode, activeTabId, setMainView } = useLayoutStore();
  // 展开状态默认在本地创建；非根实例使用从根透传的共享状态（保证全局展开/折叠生效）
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(new Set());
  const expanded = depth === 0 ? localExpanded : (expandedProp ?? localExpanded);
  const setExpanded = depth === 0 ? setLocalExpanded : (setExpandedProp ?? setLocalExpanded);
  // 顶部“全部展开/折叠”按钮的状态：false=折叠（默认），true=展开
  const [allExpanded, setAllExpanded] = useState(false);
  // 重命名 / 新建后内联编辑态：{ path, name, kind }
  const [editing, setEditing] = useState<{ path: string; name: string; kind: 'dir' | 'file' } | null>(null);

  // 新建目录（根或子目录），初始名“未命名目录”，创建后自动进入重命名态
  const handleCreateDir = async (parentPath: string) => {
    if (!activeKb) return;
    try {
      const newPath = await window.forge.fs.createDir(activeKb.id, parentPath, '未命名目录');
      const t = await window.forge.fs.listTree(activeKb.id);
      setTree(t);
      // 展开并进入重命名
      setExpanded((s) => new Set([...s, parentPath]));
      setEditing({ path: newPath, name: '未命名目录', kind: 'dir' });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  };

  // 确认重命名（目录/笔记共用，按 kind 分流）
  const commitRename = async () => {
    if (!editing || !activeKb) {
      setEditing(null);
      return;
    }
    const name = editing.name.trim();
    const oldPath = editing.path;
    const kind = editing.kind;
    setEditing(null);
    if (!name) return;
    // 当前名（笔记需去掉 .md 后缀比较）
    const curBase = oldPath.includes('/') ? oldPath.slice(oldPath.lastIndexOf('/') + 1) : oldPath;
    const curName = kind === 'file' ? curBase.replace(/\.md$/i, '') : curBase;
    if (name === curName) return; // 未变化
    try {
      if (kind === 'file') {
        const newPath = await window.forge.fs.renameNote(activeKb.id, oldPath, name);
        // 若正在编辑的恰好是当前打开的笔记，同步切换激活标签到新路径
        if (oldPath === activeTabId && newPath) {
          useLayoutStore.getState().setActiveTab(newPath);
        }
      } else {
        await window.forge.fs.renameDir(activeKb.id, oldPath, name);
      }
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
      if (depth === 0) {
        setExpanded(new Set([node.id]));
        setAllExpanded(false);
      }
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
        setAllExpanded(true);
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
      <div
        data-tree
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openTreeCtxMenu('dir', '', activeKb?.name || node.name, e.clientX, e.clientY);
        }}
      >
        {/* 视图内顶部快捷操作栏：新建笔记 / 新建目录 / 排序 / 折叠 / 展开
            （属于知识库视图内的快捷操作，不占用 LeftPanel 顶部） */}
        <div className="h-12 flex items-center gap-0.5 px-1 border-b border-border-soft bg-toolbar text-xs">
          <button
            onClick={() => openCreateNote()}
            className="h-10 w-10 flex items-center justify-center text-fg-secondary hover:bg-hover-bg rounded-xl transition-colors"
            title="新建笔记"
          ><Icon name="document-plus" className="w-4 h-4" /></button>
          <button
            onClick={() => handleCreateDir('')}
            className="h-10 w-10 flex items-center justify-center text-fg-secondary hover:bg-hover-bg rounded-xl transition-colors"
            title="新建目录"
          ><Icon name="folder-plus" className="w-4 h-4" /></button>
          <div className="relative group">
            <button
              className="h-10 w-10 flex items-center justify-center text-fg-secondary hover:bg-hover-bg rounded-xl transition-colors"
              title="排序方式"
            ><Icon name="arrows-up-down" className="w-4 h-4" /></button>
            <div className="absolute left-0 top-full mt-1 bg-content border border-border-soft rounded-xl shadow-lg z-30 hidden group-hover:block min-w-[120px] overflow-hidden">
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
                  className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-hover-bg ${
                    sortMode === s.v ? 'text-brand bg-brand-soft/30' : 'text-fg-secondary'
                  }`}
                >
                  {s.l}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              if (allExpanded) {
                window.dispatchEvent(new CustomEvent('forgenote:collapseAll'));
              } else {
                window.dispatchEvent(new CustomEvent('forgenote:expandAll'));
              }
            }}
            className="h-10 w-10 flex items-center justify-center text-fg-secondary hover:bg-hover-bg rounded-xl transition-colors"
            title={allExpanded ? '全部折叠' : '全部展开'}
          ><Icon name={allExpanded ? 'chevron-up' : 'chevron-down'} className="w-4 h-4" /></button>
          <button
            onClick={() => setMainView('diagnose')}
            className="h-10 w-10 flex items-center justify-center text-fg-secondary hover:bg-hover-bg hover:text-brand rounded-xl transition-colors"
            title="AI 诊断知识库"
          ><Icon name="viewfinder-circle" className="w-4 h-4" /></button>
        </div>
        {sortedChildren.map((c) => (
          <FileTree
            key={c.id}
            node={c}
            depth={depth + 1}
            onOpenNote={onOpenNote}
            expanded={expanded}
            setExpanded={setExpanded}
          />
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
          className="group flex items-center gap-1 py-1 pr-2 mx-1.5 rounded-xl hover:bg-hover-bg text-sm cursor-pointer transition-colors"
          style={indent}
          onClick={() => {
            const ns = new Set(expanded);
            if (isOpen) ns.delete(node.id);
            else ns.add(node.id);
            setExpanded(ns);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (depth === 0) return; // 根目录（kb_root）由上层处理
            openTreeCtxMenu('dir', node.path, node.name, e.clientX, e.clientY);
          }}
          onDragOver={(e) => {
            // 允许笔记拖入本目录
            if (e.dataTransfer.types.includes('text/note-path')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={async (e) => {
            const p = e.dataTransfer.getData('text/note-path');
            if (!p || !activeKb) return;
            e.preventDefault();
            if (p === node.path || p.startsWith(node.path + '/')) return; // 不能拖到自己或子目录
            try {
              await window.forge.fs.moveNote(activeKb.id, p, node.path);
              const t = await window.forge.fs.listTree(activeKb.id);
              setTree(t);
            } catch (err) {
              pushToast({ level: 'error', text: String(err) });
            }
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
                setEditing({ path: node.path, name: node.name, kind: 'dir' });
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
              <FileTree
                key={c.id}
                node={c}
                depth={depth + 1}
                onOpenNote={onOpenNote}
                expanded={expanded}
                setExpanded={setExpanded}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // file
  const indent = { paddingLeft: 8 + depth * 12 + 12 };
  const fileName = node.name.replace(/\.md$/i, '');
  const isEditing = editing?.path === node.path;
  return (
    <div
      className={`group flex items-center gap-1 py-1 pr-2 mx-1.5 rounded-xl text-sm cursor-pointer transition-colors ${
        node.path === activeTabId
          ? 'bg-brand-soft/50 shadow-[inset_2px_0_0_var(--brand)] text-brand font-medium'
          : 'hover:bg-hover-bg'
      }`}
      style={indent}
      onClick={() => {
        if (!isEditing) onOpenNote(node.path);
      }}
      title={node.path}
      draggable={!isEditing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/note-path', node.path);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openTreeCtxMenu('file', node.path, fileName, e.clientX, e.clientY);
      }}
    >
      <Icon name="document" className="w-4 h-4 text-fg-muted shrink-0" />
      {isEditing ? (
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
            setEditing({ path: node.path, name: fileName, kind: 'file' });
          }}
          title="双击重命名"
        >
          {fileName}
        </span>
      )}
    </div>
  );
}
