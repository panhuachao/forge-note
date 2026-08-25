import { useState, useEffect } from 'react';
import type { TreeNode } from '@shared/types';
import { useKBStore } from '../stores/kb-store';

interface Props {
  node: TreeNode;
  depth?: number;
  onOpenNote: (path: string) => void;
}

export function FileTree({ node, depth = 0, onOpenNote }: Props) {
  const { activeKb, pushToast, setTree } = useKBStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 根节点默认展开
  useEffect(() => {
    if (depth === 0) setExpanded((s) => new Set([...s, node.id]));
  }, [node.id, depth]);

  if (node.kind === 'kb_root') {
    return (
      <div data-tree>
        {node.children?.map((c) => (
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
          {node.templateIcon ? (
            <span style={{ color: node.templateColor }}>{node.templateIcon}</span>
          ) : (
            <span className="text-ink-400">📁</span>
          )}
          <span className="truncate flex-1">{node.name}</span>
          {node.templateDirId === '00' && (node.noteCount || 0) > 0 && (
            <span className="badge badge-brand">{node.noteCount}</span>
          )}
          {node.templateDirId && node.templateDirId !== '00' && (
            <span className="badge badge-gray text-[10px]">{node.noteCount || 0}</span>
          )}
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
            +
          </button>
        </div>
        {isOpen && (
          <div>
            {node.children?.map((c) => (
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
