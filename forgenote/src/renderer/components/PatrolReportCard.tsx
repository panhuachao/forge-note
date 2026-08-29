// 知识库体检报告卡片（doc/AI智能管家重构方案.md §5.2 P2-1 / §5.2 P2-5）
//
// 特点：
// - 规则类检查项**完全不依赖 AI 模型**，未配置模型时依然可以体检；
// - 每条 finding 若带 suggestion，可展开为「待确认操作」卡片，用户确认后才执行，
//   复用同一套 confirmable-action 框架（与 AI 建议共用确认/验证/回滚链路）。
import { useState } from 'react';
import { Icon } from './Icon';
import { ConfirmableActionCard } from './ConfirmableActionCard';
import { ActionVerifyBar } from './ActionVerifyBar';
import type { ConfirmableAction, PatrolFinding, PatrolReport } from '@shared/types/ai';

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  'broken-link': { label: '失效双链', icon: 'link' },
  duplicate: { label: '重复内容', icon: 'document-duplicate' },
  orphan: { label: '孤立笔记', icon: 'document' },
  'empty-dir': { label: '空目录', icon: 'folder' },
  'sparse-tag': { label: '稀疏标签', icon: 'tag' },
  structure: { label: '目录结构', icon: 'folder-tree' },
  stale: { label: '长期未更新', icon: 'clock' },
  'version-size': { label: '版本占用', icon: 'archive' }
};

const SEV_STYLE: Record<string, { label: string; cls: string; bar: string }> = {
  high: { label: '重要', cls: 'text-red-600 bg-red-500/10', bar: 'bg-red-500' },
  medium: { label: '建议', cls: 'text-amber-600 bg-amber-500/10', bar: 'bg-amber-500' },
  low: { label: '可选', cls: 'text-fg-muted bg-canvas', bar: 'bg-fg-faint' }
};

interface Props {
  report: PatrolReport | null;
  busy?: boolean;
  onRefresh: (force: boolean) => void;
  /** 用户确认执行某条建议 */
  onApply: (action: ConfirmableAction) => void;
  /** 回滚上一次执行（验证未通过时） */
  onRollback: () => void;
  verify: { ok: boolean; message: string } | null;
  onDismissVerify: () => void;
}

export function PatrolReportCard({
  report,
  busy,
  onRefresh,
  onApply,
  onRollback,
  verify,
  onDismissVerify
}: Props) {
  // 当前展开确认卡片的 finding
  const [expanded, setExpanded] = useState<string | null>(null);

  const scoreColor = !report
    ? 'text-fg-faint'
    : report.score >= 80
      ? 'text-emerald-600'
      : report.score >= 60
        ? 'text-amber-600'
        : 'text-red-600';

  return (
    <div className="rounded-2xl border border-border-soft bg-content shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* 头部：健康分 + 刷新 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-soft">
        <Icon name="shield-check" className="w-4 h-4 text-brand shrink-0" />
        <span className="text-sm font-medium text-fg">知识库体检</span>
        {report && (
          <>
            <span className={`text-lg font-semibold ${scoreColor}`}>{report.score}</span>
            <span className="text-[11px] text-fg-faint">/ 100</span>
          </>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-fg-faint">
          {report ? `更新于 ${new Date(report.at).toLocaleString('zh-CN')}` : '尚未体检'}
        </span>
        <button
          onClick={() => onRefresh(true)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs border border-border-soft text-fg-secondary hover:bg-hover-bg disabled:opacity-50 transition-colors"
        >
          <Icon name={busy ? 'arrow-path' : 'arrow-path'} className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? '体检中…' : '重新体检'}
        </button>
      </div>

      {/* 统计条 */}
      {report && (
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-px bg-border-soft/40">
          {[
            { label: '笔记', value: report.stats.noteCount },
            { label: '目录', value: report.stats.dirCount },
            { label: '标签', value: report.stats.tagCount },
            { label: '双链', value: report.stats.linkCount },
            { label: '失效链', value: report.stats.brokenLinkCount, warn: report.stats.brokenLinkCount > 0 },
            { label: '孤立', value: report.stats.orphanCount, warn: report.stats.orphanCount > 0 },
            { label: '无标签', value: report.stats.untaggedCount, warn: report.stats.untaggedCount > 0 }
          ].map((s) => (
            <div key={s.label} className="bg-content px-2 py-2 text-center">
              <div className={`text-sm font-medium ${s.warn ? 'text-amber-600' : 'text-fg'}`}>{s.value}</div>
              <div className="text-[10px] text-fg-faint">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 建议列表 */}
      <div className="divide-y divide-border-soft/60">
        {!report ? (
          <div className="px-4 py-6 text-center text-xs text-fg-faint">
            点击「重新体检」开始检查知识库健康度（无需配置 AI 模型）
          </div>
        ) : report.findings.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-emerald-600">
            未发现明显问题，知识库结构良好
          </div>
        ) : (
          report.findings.map((f) => <FindingRow key={f.id} finding={f} expanded={expanded === f.id} onToggle={() => setExpanded(expanded === f.id ? null : f.id)} onApply={onApply} />)
        )}
      </div>

      {/* 执行后验证 / 回滚 */}
      {(verify || null) && (
        <div className="px-4 pb-3">
          <ActionVerifyBar verify={verify} busy={busy} onRollback={onRollback} onDismiss={onDismissVerify} />
        </div>
      )}
    </div>
  );
}

function FindingRow({
  finding,
  expanded,
  onToggle,
  onApply
}: {
  finding: PatrolFinding;
  expanded: boolean;
  onToggle: () => void;
  onApply: (action: ConfirmableAction) => void;
}) {
  const meta = CATEGORY_META[finding.category] ?? { label: finding.category, icon: 'sparkles' };
  const sev = SEV_STYLE[finding.severity] ?? SEV_STYLE.low;
  const action = finding.suggestion;

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 w-1 self-stretch rounded-full ${sev.bar} shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${sev.cls}`}>{sev.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-canvas text-fg-muted">{meta.label}</span>
            <span className="text-xs font-medium text-fg">{finding.title}</span>
          </div>
          <div className="mt-1 text-[11px] text-fg-secondary leading-relaxed">{finding.detail}</div>
          {finding.affected.length > 0 && (
            <div className="mt-1 text-[10px] text-fg-faint font-mono truncate">
              涉及：{finding.affected.slice(0, 5).join('、')}
              {finding.affected.length > 5 ? ` 等 ${finding.affected.length} 项` : ''}
            </div>
          )}
        </div>
        {action && (
          <button
            onClick={() => {
              onToggle();
            }}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs bg-brand text-brand-fg hover:bg-brand-hover transition-colors"
          >
            <Icon name="sparkles" className="w-3 h-3" />
            {expanded ? '收起' : '一键修复'}
          </button>
        )}
      </div>

      {expanded && action && (
        <div className="mt-2">
          <ConfirmableActionCard action={action} onConfirm={() => onApply(action)} onCancel={onToggle} />
        </div>
      )}
    </div>
  );
}
