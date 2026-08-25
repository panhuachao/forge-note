import { useState, useEffect, useMemo } from 'react';
import type { TreeNode } from '@shared/types';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore, SortMode } from '../stores/layout-store';

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
          className="group flex items-center gap-1 py-0.5 pr-2 hover:bg-ink-100 text-sm cursor-pointer"
          style={indent}
          onClick={() => {
            const ns = new Set(expanded);
            if (isOpen) ns.delete(node.id);
            else ns.add(node.id);
            setExpanded(ns);
          }}
        >
          <span className="w-3 text-ink-400 text-[10px]">{isOpen ? '▼' : '▶'}</span>
          <span className="text-ink-400">📁</span>
          <span className="truncate flex-1">{node.name}</span>
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
            ✎
          </button>
          <button
            className="icon-btn opacity-0 group-hover:opacity-100 text-xs"
            onClick={async (e) => {
              e.stopPropagation();
              if (!activeKb) return;
              const name = prompt('新建子目录名称', '新文件夹');
              if (!name) return;
              try {
                await window.forge.fs.createDir(activeKb.id, node.path, name);
                const t = await window.forge.fs.listTree(activeKb.id);
                setTree(t);
              } catch (err) {
                pushToast({ level: 'error', text: String(err) });
              }
            }}
            title="新建子目录"
          >
            ＋
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
      className="group flex items-center gap-1 py-0.5 pr-2 hover:bg-ink-100 text-sm cursor-pointer"
      style={indent}
      onClick={() => onOpenNote(node.path)}
      title={node.path}
    >
      <span className="text-ink-400 text-xs">📄</span>
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
        🗑
      </button>
    </div>
  );
}
