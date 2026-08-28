// AI 建议的「待确认操作」卡片（doc/MCP技术实现方案.md §6）
// AI 在建议模式下产出 ConfirmableAction（pending），本组件渲染预览并提供「确认 / 放弃」，
// 用户确认后由主进程 actionService 执行。新增操作类型只需在此加一个分支。
import { useState } from 'react';
import { Icon } from './Icon';
import type { ConfirmableAction, NotePatchPreview } from '@shared/types/ai';

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
  createNote: '新建笔记'
};

export function ConfirmableActionCard({ action, onConfirm, onCancel, busy }: CardProps) {
  switch (action.type) {
    case 'notePatch':
      return <NotePatchCard action={action} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />;
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
  busy,
  confirmLabel
}: {
  title: string;
  badge: string;
  children: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  copyText?: string;
  busy?: boolean;
  confirmLabel: string;
}) {
  const [copied, setCopied] = useState(false);
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
        {copyText && (
          <button
            onClick={doCopy}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-fg-secondary text-[11px] hover:bg-hover-bg transition-colors"
            title="复制"
          >
            <Icon name={copied ? 'check-circle' : 'clipboard'} className="w-3.5 h-3.5" />
            {copied ? '已复制' : '复制'}
          </button>
        )}
      </div>
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
        <pre className="text-[10px] leading-relaxed bg-canvas/80 rounded-lg p-2 overflow-auto max-h-44 whitespace-pre-wrap break-all font-mono">
          {pv.diff}
        </pre>
      ) : (
        <div className="text-[11px] text-fg-faint">（无 diff 预览）</div>
      )}
      {blocked && (
        <div className="mt-1.5 text-[10px] text-fg-faint">请让 AI 重新生成修改建议后再确认。</div>
      )}
    </Shell>
  );
}

/** 其它类型（更新设置 / 打开弹窗 / 未来扩展）：展示结构化参数 */
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
