// 用户画像面板（doc/用户画像实现方案.md §6.1 / 阶段 A：只读展示 + 手动修正）
// 用法：<UserProfilePanel />，一般嵌入设置页。
import { useState } from 'react';
import { useUserProfile } from '../stores/useUserProfile';
import { Icon } from './Icon';
import type {
  UserProfile,
  Tone,
  Depth,
  Proactivity,
  ProfileTopic
} from '@shared/types';

const TONE_LABEL: Record<Tone, string> = { concise: '简洁', detailed: '详尽', socratic: '启发式', casual: '随意' };
const DEPTH_LABEL: Record<Depth, string> = { intro: '入门', intermediate: '进阶', expert: '专家' };
const PROACT_LABEL: Record<Proactivity, string> = { passive: '被动', balanced: '均衡', proactive: '主动' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border-soft last:border-0">
      <div className="w-24 shrink-0 text-xs text-fg-muted pt-1.5">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ToggleGroup<T extends string>({
  value,
  options,
  labels,
  onChange
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded border border-border-soft overflow-hidden">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1 text-sm ${value === o ? 'bg-brand text-brand-fg' : 'text-fg-secondary hover:bg-hover-bg'}`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function InterestItem({ t }: { t: ProfileTopic }) {
  return (
    <div className="flex items-center gap-2 text-sm py-1">
      <span className="px-2 py-0.5 rounded-full bg-brand-soft text-brand text-xs">{t.name}</span>
      <span className="text-xs text-fg-muted">权重 {t.weight.toFixed(2)}</span>
      <span className="text-xs text-fg-muted">· {t.source}</span>
      {t.evidence && <span className="text-xs text-fg-muted truncate max-w-[220px]">· {t.evidence}</span>}
    </div>
  );
}

export function UserProfilePanel() {
  const { profile, loading, save, reset } = useUserProfile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UserProfile | null>(null);

  if (!profile) {
    return (
      <div className="bg-content rounded-xl border border-border-soft p-5">
        <h2 className="font-semibold mb-1 flex items-center gap-2">
          <Icon name="sparkles" className="w-4 h-4 text-brand" /> 用户画像
        </h2>
        <p className="text-sm text-fg-muted mt-3">{loading ? '加载中…' : '尚未建立画像。在与 AI 协作（问答/诊断）后，画像会自动完善。'}</p>
      </div>
    );
  }

  const view = draft ?? profile;

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(profile)));
    setEditing(true);
  }

  async function commit() {
    if (!draft) return;
    await save(draft);
    setDraft(null);
    setEditing(false);
  }

  function cancel() {
    setDraft(null);
    setEditing(false);
  }

  function patchBasics(p: Partial<UserProfile['basics']>) {
    setDraft((d) => (d ? { ...d, basics: { ...d.basics, ...p } } : d));
  }
  function patchPref(p: Partial<UserProfile['preferences']>) {
    setDraft((d) => (d ? { ...d, preferences: { ...d.preferences, ...p } } : d));
  }

  return (
    <div className="bg-content rounded-xl border border-border-soft p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <Icon name="sparkles" className="w-4 h-4 text-brand" /> 用户画像
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">置信度 {(view.confidence * 100).toFixed(0)}%</span>
          {!editing ? (
            <button
              onClick={startEdit}
              className="px-3 py-1 rounded text-sm bg-brand-soft text-brand border border-brand/20 hover:bg-brand-soft/70"
            >
              编辑
            </button>
          ) : (
            <>
              <button onClick={cancel} className="px-3 py-1 rounded text-sm border border-border-soft hover:bg-hover-bg">
                取消
              </button>
              <button onClick={commit} className="px-3 py-1 rounded text-sm bg-brand text-brand-fg hover:opacity-90">
                保存
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-fg-muted mb-3">
        AI 在与你协作时会参考这份长期画像（身份 / 关注领域 / 协作偏好 / 兴趣主题）。手动编辑的字段优先级最高。该数据只会保存在你本地。
      </p>

      <Row label="身份">
        {editing ? (
          <input
            className="w-full px-2 py-1 rounded border border-border-soft bg-canvas text-sm"
            value={view.basics.role ?? ''}
            placeholder="如：产品经理 / 独立开发者"
            onChange={(e) => patchBasics({ role: e.target.value })}
          />
        ) : (
          <span className="text-sm">{view.basics.role || '—'}</span>
        )}
      </Row>

      <Row label="关注领域">
        {editing ? (
          <input
            className="w-full px-2 py-1 rounded border border-border-soft bg-canvas text-sm"
            value={(view.basics.domains ?? []).join('、')}
            placeholder="用顿号分隔，如：AI、个人知识管理"
            onChange={(e) =>
              patchBasics({ domains: e.target.value.split(/[、，,]/).map((s) => s.trim()).filter(Boolean) })
            }
          />
        ) : (
          <span className="text-sm">{view.basics.domains?.join('、') || '—'}</span>
        )}
      </Row>

      <Row label="当前目标">
        {editing ? (
          <input
            className="w-full px-2 py-1 rounded border border-border-soft bg-canvas text-sm"
            value={(view.basics.goals ?? []).join('、')}
            placeholder="用顿号分隔"
            onChange={(e) =>
              patchBasics({ goals: e.target.value.split(/[、，,]/).map((s) => s.trim()).filter(Boolean) })
            }
          />
        ) : (
          <span className="text-sm">{view.basics.goals?.join('、') || '—'}</span>
        )}
      </Row>

      <Row label="协作偏好">
        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-muted w-12">风格</span>
              <ToggleGroup value={view.preferences.tone} options={['concise', 'detailed', 'socratic', 'casual'] as const} labels={TONE_LABEL} onChange={(v) => patchPref({ tone: v })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-muted w-12">深度</span>
              <ToggleGroup value={view.preferences.depth} options={['intro', 'intermediate', 'expert'] as const} labels={DEPTH_LABEL} onChange={(v) => patchPref({ depth: v })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-muted w-12">主动度</span>
              <ToggleGroup value={view.preferences.proactivity} options={['passive', 'balanced', 'proactive'] as const} labels={PROACT_LABEL} onChange={(v) => patchPref({ proactivity: v })} />
            </div>
          </div>
        ) : (
          <span className="text-sm">
            {TONE_LABEL[view.preferences.tone]} / {DEPTH_LABEL[view.preferences.depth]} / {PROACT_LABEL[view.preferences.proactivity]}
          </span>
        )}
      </Row>

      <Row label="兴趣主题">
        <div className="max-h-40 overflow-y-auto">
          {view.interests.length ? (
            view.interests.map((t) => <InterestItem key={t.name} t={t} />)
          ) : (
            <span className="text-sm text-fg-muted">—</span>
          )}
        </div>
      </Row>

      {view.persona && (
        <Row label="画像简述">
          <p className="text-sm text-fg-secondary whitespace-pre-wrap">{view.persona}</p>
        </Row>
      )}

      {view.audit.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border-soft">
          <div className="text-xs text-fg-muted mb-1">最近更新</div>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {[...view.audit].reverse().slice(0, 8).map((a, i) => (
              <div key={i} className="text-xs text-fg-muted">
                {new Date(a.ts).toLocaleString()} · {a.skill} · {a.delta.slice(0, 80)}
              </div>
            ))}
          </div>
        </div>
      )}

      {!editing && (
        <div className="mt-4 pt-3 border-t border-border-soft flex justify-end">
          <button
            onClick={async () => {
              if (confirm('确定清空用户画像？此操作不可撤销。')) await reset();
            }}
            className="px-3 py-1 rounded text-sm border border-border-soft text-fg-muted hover:bg-hover-bg"
          >
            清空画像
          </button>
        </div>
      )}
    </div>
  );
}
