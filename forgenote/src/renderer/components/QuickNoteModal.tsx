import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import type { TreeNode } from '@shared/types';

interface Props {
  open: boolean;
  onClose: () => void;
  initialContent?: string;
}

function flattenDirs(node: TreeNode, depth = 0): { path: string; label: string; id: string }[] {
  const out: { path: string; label: string; id: string }[] = [];
  if (node.kind === 'dir' && node.path) {
    // 目录名形如 "01 项目"，id 取前缀数字
    const idMatch = node.name.match(/^(\d{2})/);
    out.push({ path: node.path, label: node.name, id: idMatch ? idMatch[1] : node.name });
  }
  if (node.children) {
    for (const c of node.children) out.push(...flattenDirs(c, depth + 1));
  }
  return out;
}

export function QuickNoteModal({ open, onClose, initialContent = '' }: Props) {
  const { activeKb, tree, createQuickNote } = useKBStore();
  const [content, setContent] = useState('');
  const [dirId, setDirId] = useState(''); // 可选：指定归属目录
  const [submitting, setSubmitting] = useState(false);

  const dirs = tree ? flattenDirs(tree).filter((d) => d.path) : [];
  const detectedUrls = content.match(/https?:\/\/[^\s，。、）)】\]]+/gi) || [];

  useEffect(() => {
    if (open) {
      setContent(initialContent);
      setDirId('');
      setSubmitting(false);
    }
  }, [open, initialContent]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createQuickNote(content, dirId || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-[640px] max-w-[92vw] max-h-[88vh] flex flex-col rounded-xl bg-content shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-fg">⚡ 快速笔记</h2>
          <button onClick={onClose} className="text-fg-faint hover:text-fg-secondary text-xl leading-none">×</button>
        </div>

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            粘贴一段话、一篇文章，或一段带链接的内容（如分享对话、产品介绍网页）。确认后 AI 会自动归纳摘要、补充标签与双向链接；若含外部链接，将抓取正文并归入「外部资源」，同时记录原始链接。
          </p>
          <textarea
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="在此粘贴你的内容…"
            className="input h-56 resize-none font-mono text-sm leading-relaxed"
          />

          {detectedUrls.length > 0 && (
            <div className="rounded border border-brand-border bg-brand-soft/40 px-3 py-2 text-xs text-fg-secondary">
              <div className="font-medium text-brand">检测到 {detectedUrls.length} 个外部链接</div>
              <ul className="mt-1 space-y-0.5 break-all">
                {detectedUrls.slice(0, 3).map((u, i) => (
                  <li key={i} className="truncate">🔗 {u}</li>
                ))}
                {detectedUrls.length > 3 && <li className="text-fg-muted">…等 {detectedUrls.length} 个</li>}
              </ul>
              <div className="mt-1 text-fg-muted">将抓取整篇正文、由 AI 判断归入合适目录，并保存原始链接与正文提取。</div>
            </div>
          )}

          {dirs.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-muted">指定目录（可选，留空由 AI 推荐）：</span>
              <select
                value={dirId}
                onChange={(e) => setDirId(e.target.value)}
                className="input flex-1 text-sm"
              >
                <option value="">AI 自动推荐</option>
                {dirs.map((d) => (
                  <option key={d.path} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!activeKb && (
            <p className="text-xs text-amber-600">未检测到知识库，请先在左侧打开或创建知识库。</p>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="btn btn-ghost">取消</button>
          <button
            onClick={submit}
            disabled={!content.trim() || submitting || !activeKb}
            className="btn btn-primary disabled:opacity-50"
          >
            {submitting ? 'AI 整理中…' : '确认并整理'}
          </button>
        </div>
      </div>
    </div>
  );
}
