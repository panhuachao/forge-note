// 知识库管理弹窗：新增 / 切换 / 删除知识库（仅移除客户端记录，不删除原目录）
import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import type { KBSummary } from '@shared/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function KbManagerModal({ open, onClose }: Props) {
  const { activeKb, kbs, setKBs, setActiveKb, setTree, setApplied, pushToast } = useKBStore();
  const [loading, setLoading] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<KBSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function refresh() {
    setKBs(await window.forge.kb.list());
  }

  async function handleAdd() {
    setLoading(true);
    try {
      const kb = await window.forge.kb.add();
      if (kb) {
        await refresh();
        await handleSwitch(kb.id);
        pushToast({ level: 'success', text: `已添加知识库：${kb.name}` });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSwitch(id: string) {
    const k = kbs.find((x) => x.id === id);
    if (!k) return;
    await window.forge.kb.setActive(id);
    setActiveKb({ id: k.id, name: k.name, rootPath: k.rootPath, createdAt: 0, templateId: k.templateId });
    const t = await window.forge.fs.listTree(id);
    setTree(t);
    const a = await window.forge.template.applied(id);
    setApplied(a);
  }

  async function performRemove(kb: KBSummary) {
    await window.forge.kb.remove(kb.id);
    await refresh();
    if (activeKb?.id === kb.id) {
      const remaining = kbs.filter((k) => k.id !== kb.id);
      if (remaining.length > 0) {
        await handleSwitch(remaining[0].id);
      } else {
        setActiveKb(null);
        setTree(null);
        setApplied(null);
      }
    }
    pushToast({ level: 'success', text: `已移除知识库「${kb.name}」` });
  }

  function handleRemove(kb: KBSummary) {
    setPendingRemove(kb);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="w-[520px] max-w-[92vw] max-h-[80vh] flex flex-col rounded-xl bg-content shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft">
          <h2 className="text-base font-semibold text-fg flex items-center gap-2">
            <Icon name="folder-tree" className="w-4 h-4 text-brand" />
            知识库管理
          </h2>
          <button
            onClick={onClose}
            className="icon-btn"
            aria-label="关闭"
          >
            <Icon name="x-mark" className="w-4 h-4" />
          </button>
        </div>

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {kbs.length === 0 && (
            <div className="text-sm text-fg-secondary text-center py-6">暂无知识库，点击下方按钮新增。</div>
          )}
          {kbs.map((kb) => {
            const isActive = activeKb?.id === kb.id;
            return (
              <div
                key={kb.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  isActive
                    ? 'bg-brand-soft/40 border-brand/30'
                    : 'bg-canvas border-border-soft hover:bg-hover-bg'
                }`}
              >
                <button
                  onClick={() => handleSwitch(kb.id)}
                  className="flex-1 min-w-0 text-left"
                  title="设为当前知识库"
                >
                  <div className={`text-sm truncate ${isActive ? 'text-brand font-medium' : 'text-fg'}`}>
                    {kb.name}
                  </div>
                  <div className="text-[11px] text-fg-faint truncate" title={kb.rootPath}>
                    {kb.rootPath}
                  </div>
                </button>
                <button
                  onClick={() => handleRemove(kb)}
                  className="icon-btn text-fg-muted hover:text-brand"
                  title="移除客户端记录"
                  aria-label="移除"
                >
                  <Icon name="trash" className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-soft">
          <p className="text-[11px] text-fg-faint leading-relaxed">
            删除仅移除客户端显示，不会删除原目录文件。
          </p>
          <button onClick={handleAdd} disabled={loading} className="btn btn-primary text-sm">
            {loading ? '添加中…' : '新增知识库'}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={pendingRemove !== null}
        title={`移除知识库「${pendingRemove?.name ?? ''}」？`}
        message={`仅删除客户端显示记录，不会删除原目录中的文件。如需彻底清理，请自行删除文件夹：\n${pendingRemove?.rootPath ?? ''}`}
        confirmText="移除"
        cancelText="取消"
        danger
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) performRemove(pendingRemove);
          setPendingRemove(null);
        }}
      />
    </div>
  );
}
