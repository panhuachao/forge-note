// AI 建议的「待确认操作」卡片（doc/MCP技术实现方案.md §6）
// AI 在建议模式下产出 ConfirmableAction（pending），本组件渲染预览并提供「确认 / 放弃」，
// 用户确认后由主进程 actionService 执行。新增操作类型只需在此加一个分支。
import { useState } from 'react';
import { Icon } from './Icon';
import type { BatchPatchPreview, ConfirmableAction, NotePatchPreview } from '@shared/types/ai';

interface CardProps {
  action: ConfirmableAction;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  notePatch: '修改笔记',
  settingUpdate: '更新设置',
  openDialog: '打开弹窗',
  moveNote: '移动笔记',
  createNote: '新建笔记',
  // 批量任务（doc/AI智能管家重构方案.md §6.2 P2-4）
  batchPatch: '批量修改',
  batchMove: '批量移动',
  batchRetag: '批量打标签'
};

export function ConfirmableActionCard({ action, onConfirm, onCancel, busy }: CardProps) {
  switch (action.type) {
    case 'notePatch':
      return <NotePatchCard action={action} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />;
    case 'batchPatch':
      return <BatchPatchCard action={action} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />;
    default:
      return <GenericActionCard action={action} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />;
  }
}

function Shell({
  title,
  badge,
  children,
  onConfirm,
  onCancel,
  copyText,
  viewText,
  busy,
  confirmLabel
}: {
  title: string;
  badge: string;
  children: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  copyText?: string;
  viewText?: string;
  busy?: boolean;
  confirmLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const doCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <>
      <div className="my-2 rounded-xl border border-brand/30 bg-brand-soft/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-brand/20">
        <Icon name="sparkles" className="w-3.5 h-3.5 text-brand" />
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-brand/15 text-brand font-medium">{badge}</span>
        <span className="text-xs font-medium text-fg truncate">{title}</span>
      </div>
      <div className="px-3 py-2">{children}</div>
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-brand text-brand-fg text-[11px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Icon name="check-circle" className="w-3.5 h-3.5" />
          {busy ? '执行中…' : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-border-soft text-fg-secondary text-[11px] hover:bg-hover-bg disabled:opacity-50 transition-colors"
        >
          <Icon name="x-mark" className="w-3.5 h-3.5" />
          放弃
        </button>
        {viewText && (
          <button
            onClick={() => setViewOpen(true)}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-fg-secondary text-[11px] hover:bg-hover-bg transition-colors"
            title="查看"
          >
            <Icon name="eye" className="w-3.5 h-3.5" />
            查看
          </button>
        )}
        {copyText && (
          <button
            onClick={doCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-fg-secondary text-[11px] hover:bg-hover-bg transition-colors"
            title="复制"
          >
            <Icon name={copied ? 'check-circle' : 'clipboard'} className="w-3.5 h-3.5" />
            {copied ? '已复制' : '复制'}
          </button>
        )}
      </div>
    </div>

    {viewOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        onClick={() => setViewOpen(false)}
      >
        <div
          className="bg-content border border-border rounded-2xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-soft">
            <span className="text-sm font-medium text-fg truncate">{title}</span>
            <button
              onClick={() => setViewOpen(false)}
              className="p-1 rounded-lg hover:bg-hover-bg text-fg-secondary transition-colors"
            >
              <Icon name="x-mark" className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <DiffViewer diff={viewText} className="text-xs" />
          </div>
        </div>
      </div>
    )}
    </>
  );
}

/** 按 Git diff 风格高亮 +/-/@@/文件头行，支持暗黑模式 */
function DiffViewer({ diff, className = '' }: { diff: string; className?: string }) {
  const lines = diff.split('\n');
  return (
    <div className={`font-mono leading-relaxed whitespace-pre-wrap break-all ${className}`}>
      {lines.map((line, idx) => {
        const type = line.startsWith('+') && !line.startsWith('+++ ')
          ? 'add'
          : line.startsWith('-') && !line.startsWith('--- ')
          ? 'del'
          : line.startsWith('@@') || line.startsWith('+++ ') || line.startsWith('--- ')
          ? 'meta'
          : 'ctx';
        return (
          <span
            key={idx}
            className={`block px-1 -mx-1 rounded-sm ${
              type === 'add'
                ? 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : type === 'del'
                ? 'bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                : type === 'meta'
                ? 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                : 'text-fg'
            }`}
          >
            {line || ' '}
          </span>
        );
      })}
    </div>
  );
}

/** 笔记修改：展示 diff 预览 */
function NotePatchCard({ action, onConfirm, onCancel, busy }: CardProps) {
  const pv = action.preview as NotePatchPreview | undefined;
  const payload = (action.payload ?? {}) as { notePath?: string };
  const notePath = pv?.notePath || payload.notePath || '';
  const blocked = pv ? !pv.canApply : false;

  return (
    <Shell
      title={action.title || `修改：${notePath}`}
      badge={TYPE_LABEL.notePatch}
      confirmLabel="确认修改"
      busy={busy}
      copyText={pv?.diff}
      viewText={pv?.diff}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {action.description && <div className="text-[11px] text-fg-secondary mb-1.5 leading-relaxed">{action.description}</div>}
      <div className="flex items-center gap-2 text-[10px] text-fg-faint mb-1.5">
        <span className="font-mono truncate">{notePath}</span>
        {pv && <span>· 影响 {pv.affectedLines} 处</span>}
      </div>
      {blocked && (
        <div className="mb-1.5 text-[11px] text-red-500">
          该修改无法安全应用：{pv?.message || '未知原因'}
        </div>
      )}
      {pv?.diff ? (
        <div className="text-[10px] bg-canvas/80 rounded-lg p-2 overflow-auto max-h-44">
          <DiffViewer diff={pv.diff} />
        </div>
      ) : (
        <div className="text-[11px] text-fg-faint">（无 diff 预览）</div>
      )}
      {blocked && (
        <div className="mt-1.5 text-[10px] text-fg-faint">请让 AI 重新生成修改建议后再确认。</div>
      )}
    </Shell>
  );
}

/**
 * 批量修改（P2-4）：逐条列出每篇笔记的 diff 摘要。
 * 一次整理几十篇笔记时，逐篇确认会让用户点到崩溃，这里聚合为一次确认。
 */
function BatchPatchCard({ action, onConfirm, onCancel, busy }: CardProps) {
  const pv = action.preview as BatchPatchPreview | undefined;
  const items = pv?.items ?? [];
  const applicable = pv?.applicable ?? items.filter((i) => i.canApply).length;
  const blocked = items.length > 0 && applicable === 0;

  return (
    <Shell
      title={action.title || `批量修改 ${items.length} 篇笔记`}
      badge={TYPE_LABEL.batchPatch}
      confirmLabel={`确认修改 ${applicable} 篇`}
      busy={busy}
      copyText={items.map((i) => i.diff).filter(Boolean).join('\n\n')}
      viewText={items.map((i) => `--- ${i.notePath} ---\n${i.diff}`).filter(Boolean).join('\n\n')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {action.description && <div className="text-[11px] text-fg-secondary mb-1.5 leading-relaxed">{action.description}</div>}
      <div className="flex items-center gap-2 text-[10px] text-fg-faint mb-1.5">
        <span>共 {items.length} 篇</span>
        <span>· 可安全应用 {applicable} 篇</span>
        {items.length !== applicable && <span className="text-amber-600">· {items.length - applicable} 篇将跳过</span>}
      </div>
      {blocked && <div className="mb-1.5 text-[11px] text-red-500">所有修改都无法安全应用，请让 AI 重新生成建议。</div>}
      <div className="max-h-48 overflow-auto space-y-1">
        {items.slice(0, 30).map((it, idx) => (
          <div key={`${it.notePath}_${idx}`} className="flex items-start gap-2 text-[11px]">
            <span className={it.canApply ? 'text-emerald-600' : 'text-red-500'}>
              {it.canApply ? '✓' : '✕'}
            </span>
            <span className="font-mono text-fg-secondary truncate flex-1">{it.notePath}</span>
            <span className="text-fg-faint shrink-0">{it.affectedLines} 处</span>
          </div>
        ))}
        {items.length > 30 && <div className="text-[10px] text-fg-faint">…其余 {items.length - 30} 篇未列出</div>}
      </div>
    </Shell>
  );
}

/** 其它类型（更新设置 / 打开弹窗 / 批量移动 / 批量标签 / 未来扩展）：展示结构化参数 */
function GenericActionCard({ action, onConfirm, onCancel, busy }: CardProps) {
  const label = TYPE_LABEL[action.type] || action.type;
  const paramsText = (() => {
    try {
      return JSON.stringify(action.preview ?? action.payload, null, 2);
    } catch {
      return String(action.payload ?? '');
    }
  })();

  return (
    <Shell
      title={action.title || label}
      badge={label}
      confirmLabel="确认执行"
      busy={busy}
      copyText={paramsText}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {action.description && <div className="text-[11px] text-fg-secondary mb-1.5 leading-relaxed">{action.description}</div>}
      <pre className="text-[10px] leading-relaxed bg-canvas/80 rounded-lg p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all font-mono">
        {paramsText}
      </pre>
    </Shell>
  );
}
