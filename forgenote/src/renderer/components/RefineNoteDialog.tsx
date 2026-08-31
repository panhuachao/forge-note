import { useEffect, useMemo, useState } from 'react';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import { Icon } from './Icon';

/**
 * 笔记完善确认弹窗：左侧原文，右侧 AI 重写版本，用户点「确认调整」才覆盖。
 * 设计目的：refineNote 偶尔会输出非笔记内容（对话、确认话术等），
 * 由用户在对比 UI 中人工把关，避免 AI 跑偏直接破坏原文。
 *
 * Props:
 * - open: 是否显示
 * - original: 当前笔记原文
 * - refined: AI 输出的「重写后」笔记
 * - onConfirm: 用户点确认（refined 整体替换 original）
 * - onClose: 用户点取消 / ESC / 遮罩
 */
interface Props {
  open: boolean;
  original: string;
  refined: string;
  /** 知识库 ID：用于预览时解析资产相对路径（.assets/、图片） */
  kbId?: string;
  /** 当前笔记相对路径：用于预览时解析资产相对路径 */
  currentPath?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function RefineNoteDialog({ open, original, refined, kbId, currentPath, onConfirm, onClose }: Props) {
  // 0=原文 | 1=新版
  const [tab, setTab] = useState<1 | 0>(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setTab(1);
      setBusy(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) {
        // Cmd/Ctrl+Enter 快速确认
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  // 简单「长度 / 行数」统计，给用户直观感受
  const stats = useMemo(() => {
    const lines = (s: string) => s.split('\n').length;
    const chars = (s: string) => s.length;
    return {
      orig: { lines: lines(original), chars: chars(original) },
      next: { lines: lines(refined), chars: chars(refined) }
    };
  }, [original, refined]);

  // kbId/currentPath 用于预览时正确解析 .assets/、相对路径图片；缺省则降级为空字符串（资产回退为原 src）
  // 注意：所有 hooks 必须在任何提前 return 之前调用，否则会触发
  // "Rendered more hooks than during the previous render" 错误。
  const previewHtml = useMemo(
    () => renderMarkdownPreview(tab === 0 ? original : refined, kbId || '', currentPath || ''),
    [tab, original, refined, kbId, currentPath]
  );

  if (!open) return null;

  function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      onConfirm();
    } finally {
      setBusy(false);
    }
  }

  const activeText = tab === 0 ? original : refined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="w-[min(1100px,95vw)] max-h-[88vh] bg-content border border-border-soft rounded-xl shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft">
          <div className="flex items-center gap-2">
            <Icon name="sparkles" className="w-4 h-4 text-brand" />
            <h2 className="text-base font-semibold text-fg-primary">完善笔记 · 对比预览</h2>
            <span className="text-xs text-fg-muted ml-2">
              请确认 AI 的调整是否合理；只有点击「确认调整」才会覆盖原文
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg p-1 rounded"
            title="关闭"
          >
            <Icon name="x-mark" className="w-4 h-4" />
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-5 py-2 text-xs text-fg-muted border-b border-border-soft bg-hover-bg/40">
          <span>
            原文：<span className="text-fg-secondary font-mono">{stats.orig.lines}</span> 行 ·{' '}
            <span className="text-fg-secondary font-mono">{stats.orig.chars}</span> 字
          </span>
          <span className="text-fg-muted">→</span>
          <span>
            新版：<span className="text-brand font-mono">{stats.next.lines}</span> 行 ·{' '}
            <span className="text-brand font-mono">{stats.next.chars}</span> 字
          </span>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 pt-2">
          <TabBtn active={tab === 1} onClick={() => setTab(1)} label="新版（AI 重写）" />
          <TabBtn active={tab === 0} onClick={() => setTab(0)} label="原文" />
          <div className="flex-1" />
          <span className="text-[11px] text-fg-muted">
            <kbd className="px-1.5 py-0.5 rounded border border-border-soft text-[10px]">⌘/Ctrl+Enter</kbd>{' '}
            确认
          </span>
        </div>

        {/* Preview area：固定高度 + 内部滚动，与 NotePane 的预览样式保持一致 */}
        <div className="flex-1 min-h-0 px-5 pb-4 pt-2 overflow-hidden">
          <div
            className="markdown-preview h-full overflow-y-auto rounded-md border border-border-soft bg-bg-primary p-6"
            // renderMarkdownPreview 返回已转义的安全 HTML（escapeHtml 处理过图片/链接/wiki 链接）
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border-soft">
          <div className="text-xs text-fg-muted">
            提示：取消则丢弃 AI 重写，原文保持不变。
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="btn btn-secondary px-5 py-2 text-sm disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={busy}
              className="px-5 py-2 text-sm rounded-xl font-medium transition-all shadow-sm hover:shadow disabled:opacity-50 bg-brand text-brand-fg hover:bg-brand-hover"
            >
              确认调整
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-t-md border-b-2 transition-colors ${
        active
          ? 'border-brand text-brand font-medium'
          : 'border-transparent text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {label}
    </button>
  );
}
