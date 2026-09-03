// 主题学习 · 输入页面
// 布局：顶部 PageHeader + 中部居中输入卡片（主题 / 补充说明 / 模式 / 确认 + 实时进度）
// + 下方历史学习记录列表。点击历史条目进入「学习页面」（learn-session）阅读。
import { useEffect, useState } from 'react';
import { useKBStore, requireAI } from '../stores/kb-store';
import { useLearnStore } from '../stores/learn-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import {
  LEARN_MODES,
  getLearnMode,
  type LearnModeKey,
  type LearnModule,
  type LearnProgress,
  type LearnSessionSummary
} from '@shared/types/learn';

type ArticleStatus = 'pending' | 'generating' | 'done';

// ============ 输入卡片（主题 / 补充 / 模式 / 确认 + 实时进度） ============
function LearnForm() {
  const { aiConfig } = useKBStore();
  const [topic, setTopic] = useState('');
  const [extra, setExtra] = useState('');
  const [modeKey, setModeKey] = useState<LearnModeKey>('normal');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [planModules, setPlanModules] = useState<LearnModule[] | null>(null);
  const [articleState, setArticleState] = useState<Record<string, ArticleStatus>>({});
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [step, setStep] = useState<1 | 2 | undefined>(undefined);
  const [articleNo, setArticleNo] = useState(0);
  const [totalArticles, setTotalArticles] = useState(0);

  const aiEnabled = !!aiConfig && aiConfig.provider !== 'none' && !!aiConfig.model;

  const confirm = async () => {
    if (!topic.trim()) {
      setError('请填写要学习的主题');
      return;
    }
    if (!aiEnabled) {
      requireAI();
      setError('请先在「设置」中配置可用的 AI 模型（provider / model / apiKey）。');
      return;
    }
    setGenerating(true);
    setError('');
    setLogs([]);
    setPlanModules(null);
    setArticleState({});
    setDone(0);
    setTotal(0);

    const navigateToActive = async (sessionId: string) => {
      if (!sessionId) return;
      try {
        const s = await window.forge.learn.get(sessionId);
        if (s) {
          useLearnStore.getState().setActive(s);
          // 切到「学习页面」阅读，不再停留在输入页
          useLayoutStore.getState().setMainView('learn-session');
        }
      } catch {
        /* 兜底失败不阻塞，等待 await create() resolve */
      }
    };

    const onProgress = (p: LearnProgress) => {
      if (p.step) setStep(p.step);
      if (p.totalArticles != null) setTotalArticles(p.totalArticles);
      if (p.articleNo != null) setArticleNo(p.articleNo);
      if (p.phase === 'planning') {
        setLogs((l) => [...l, p.message]);
      } else if (p.phase === 'plan-ready') {
        const mods = p.modules ?? [];
        const init: Record<string, ArticleStatus> = {};
        mods.forEach((m, mi) => m.articles.forEach((_a, ai) => { init[`${mi}-${ai}`] = 'pending'; }));
        setPlanModules(mods);
        setArticleState(init);
        setTotal(mods.reduce((n, m) => n + m.articles.length, 0));
        setLogs((l) => [...l, p.message]);
      } else if (p.phase === 'article-start' && p.moduleIndex != null && p.articleIndex != null) {
        const k = `${p.moduleIndex}-${p.articleIndex}`;
        setArticleState((s) => ({ ...s, [k]: 'generating' }));
      } else if (p.phase === 'article-done' && p.moduleIndex != null && p.articleIndex != null) {
        const k = `${p.moduleIndex}-${p.articleIndex}`;
        setArticleState((s) => ({ ...s, [k]: 'done' }));
        setDone((d) => d + 1);
        // 最后一篇完成（articleNo === totalArticles）→ 立刻拉取并切到学习页，
        // 不再依赖 await create() 是否 resolve，避免按钮长期停在「AI 生成中…」。
        if (p.articleNo != null && p.totalArticles != null && p.articleNo === p.totalArticles) {
          void navigateToActive(p.sessionId);
        }
      } else if (p.phase === 'done') {
        setLogs((l) => [...l, p.message]);
        // 主进程宣告全部完成 → 兜底切到学习页（应对 create() 极端未 resolve）
        if (p.sessionId) void navigateToActive(p.sessionId);
      } else if (p.phase === 'error') {
        setError(p.message);
      }
    };

    // 进度通过 learn:progress 事件推送，需单独注册监听（create 仅收 input）
    const offProgress = window.forge.learn.onProgress(onProgress);

    try {
      const session = await window.forge.learn.create(
        { topic: topic.trim(), extra: extra.trim(), mode: modeKey }
      );
      useLearnStore.getState().setActive(session);
      useLayoutStore.getState().setMainView('learn-session');
      await useLearnStore.getState().loadList();
      // 清空输入，允许再次发起学习
      setTopic('');
      setExtra('');
    } catch (e) {
      setError(String(e));
    } finally {
      offProgress();
      setGenerating(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto rounded-2xl border border-border-soft bg-content shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* 标题区 */}
      <div className="px-6 pt-6 pb-2 border-b border-border-soft">
        <div className="flex items-center gap-2 text-base font-semibold text-fg">
          <Icon name="academic-cap" className="w-5 h-5 text-brand" />
          开始一次主题学习
        </div>
        <p className="text-xs text-fg-muted mt-1.5">
          输入你想系统学习的主题，AI 将按学习模式拆解为模块 / 文章，生成后可逐篇阅读并一键存入笔记。
        </p>
      </div>

      {/* 主体 */}
      <div className="px-6 py-5 space-y-4">
        {/* 主题 */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">主题输入</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder="例如：正则表达式、机器学习中的梯度下降、古希腊哲学史……"
            className="input w-full resize-none text-sm"
          />
        </div>

        {/* 补充说明 */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1.5">
            补充说明 / 侧重点（可选）
          </label>
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            placeholder="例如：面向后端工程师、偏重实战、结合 TypeScript 示例……"
            className="input w-full resize-none text-sm"
          />
        </div>

        {/* 学习模式 */}
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-2">选择学习模式</label>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {LEARN_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setModeKey(m.key)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  modeKey === m.key
                    ? 'border-brand bg-brand-soft shadow-[0_2px_8px_-2px_rgba(220,38,38,0.18)]'
                    : 'border-border-soft hover:bg-hover-bg'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon
                    name={m.icon as any}
                    className={`w-4 h-4 ${modeKey === m.key ? 'text-brand' : 'text-fg-muted'}`}
                  />
                  <span className="text-sm font-medium text-fg">{m.title}</span>
                </div>
                <div className="text-[11px] text-fg-faint leading-relaxed">{m.desc}</div>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-fg-faint leading-relaxed">
            {getLearnMode(modeKey).style.split('。')[0]}。
          </p>
        </div>

        {!aiEnabled && (
          <div className="text-[11px] text-amber-500 leading-relaxed">
            未检测到可用 AI 模型，请前往「设置」配置 provider / model / apiKey。
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 text-xs text-red-500 border border-red-500/20">
            {error}
          </div>
        )}

        {/* 确认按钮 */}
        <button
          onClick={confirm}
          disabled={generating || !aiEnabled || !topic.trim()}
          className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-fg font-medium hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="sparkles" className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
          {generating ? 'AI 生成中…' : '确认并生成学习文章'}
        </button>
    </div>

      {/* 进度 */}
      {generating && (
        <div className="border-t border-border-soft bg-canvas/60 px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-fg-muted">
              {step === 1 && '① 第一步 · 生成目录架构'}
              {step === 2 && `② 第二步 · 逐篇生成文章（第 ${articleNo || done}/${totalArticles || total} 篇）`}
              {step === undefined && '生成进度'}
            </span>
            {step === 2 && (
              <span className="text-[11px] text-fg-faint">
                {done}/{total} 篇完成
              </span>
            )}
          </div>
          {planModules ? (
            <div className="space-y-3">
              {planModules.map((m, mi) => (
                <div key={m.id}>
                  <div className="text-xs font-medium text-fg mb-1">{m.title}</div>
                  <div className="space-y-1 pl-3">
                    {m.articles.map((a, ai) => {
                      const st = articleState[`${mi}-${ai}`] ?? 'pending';
                      return (
                        <div key={a.id} className="flex items-center gap-2 text-[11px]">
                          {st === 'done' ? (
                            <Icon name="check-circle" className="w-3.5 h-3.5 text-green-500 shrink-0" />
                          ) : st === 'generating' ? (
                            <Icon name="arrow-path" className="w-3.5 h-3.5 text-brand animate-spin shrink-0" />
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full border border-border-soft shrink-0" />
                          )}
                          <span className={st === 'pending' ? 'text-fg-faint' : 'text-fg-muted'}>
                            {a.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-fg-muted">
              <Icon name="arrow-path" className="w-3.5 h-3.5 animate-spin text-brand" />
              正在规划学习结构…
            </div>
          )}
          {logs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-soft text-[11px] text-fg-faint space-y-0.5">
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ 历史记录列表（默认近 HISTORY_PREVIEW 条，更多进入宫格页） ============
const HISTORY_PREVIEW = 5;

function HistoryList({ onPick, onShowAll }: { onPick: (id: string) => void; onShowAll: () => void }) {
  const { sessions, removeSession } = useLearnStore();

  if (sessions.length === 0) return null;

  const shown = sessions.slice(0, HISTORY_PREVIEW);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Icon name="clock" className="w-4 h-4 text-fg-muted" />
          主题学习记录
          <span className="text-[11px] text-fg-faint font-normal">可点击直接进入学习</span>
        </div>
        <button
          onClick={onShowAll}
          className="inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:text-brand-hover transition-colors"
        >
          {sessions.length > HISTORY_PREVIEW ? '查看更多' : '查看全部'}
          <Icon name="chevron-right" className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="rounded-2xl border border-border-soft bg-content divide-y divide-border-soft overflow-hidden">
        {shown.map((s) => (
          <div
            key={s.id}
            className="group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-hover-bg transition-colors"
            onClick={() => onPick(s.id)}
          >
            <Icon
              name={s.status === 'done' ? 'academic-cap' : 'arrow-path'}
              className={`w-4 h-4 shrink-0 ${s.status === 'done' ? 'text-brand' : 'text-fg-faint'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-fg truncate">{s.topic}</div>
              <div className="text-[11px] text-fg-faint">
                {s.modeTitle} · {s.moduleCount} 模块 / {s.articleCount} 篇
                {s.status !== 'done' && (
                  <span className="ml-2 text-amber-500">· {s.status === 'error' ? '失败' : '进行中'}</span>
                )}
              </div>
            </div>
            <Icon name="chevron-right" className="w-4 h-4 text-fg-faint shrink-0" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                void removeSession(s.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-fg-faint hover:text-red-500 transition-opacity shrink-0 p-1"
              title="删除"
            >
              <Icon name="trash" className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ 全部记录宫格视图 ============
function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RecordCard({ session, onPick, onRemove }: {
  session: LearnSessionSummary;
  onPick: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const isDone = session.status === 'done';
  const isError = session.status === 'error';
  const iconName = isDone ? 'academic-cap' : 'arrow-path';
  const iconClass = isDone ? 'text-brand' : isError ? 'text-red-500' : 'text-fg-faint';
  const statusText = isDone ? '已完成' : isError ? '失败' : '进行中';
  const statusClass = isError ? 'text-red-500' : isDone ? 'text-green-500' : 'text-amber-500';

  return (
    <div
      className="group relative rounded-2xl border border-border-soft bg-content p-4 cursor-pointer hover:border-brand hover:shadow-[0_4px_14px_-6px_rgba(220,38,38,0.18)] transition-all"
      onClick={() => onPick(session.id)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          void onRemove(session.id);
        }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-fg-faint hover:text-red-500 hover:bg-red-500/10 transition-all"
        title="删除"
      >
        <Icon name="trash" className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-start gap-2 mb-3 pr-6">
        <Icon name={iconName} className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg line-clamp-2 break-all" title={session.topic}>
            {session.topic}
          </div>
          <div className="text-[11px] text-fg-faint mt-1.5">
            {session.modeTitle} · {session.moduleCount} 模块 / {session.articleCount} 篇
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-border-soft">
        <span className="text-[11px] text-fg-faint">{formatDate(session.createdAt)}</span>
        <span className={`text-[11px] font-medium ${statusClass}`}>{statusText}</span>
      </div>
    </div>
  );
}

function AllRecordsView({ onBack }: { onBack: () => void }) {
  const { sessions, removeSession, openSession } = useLearnStore();
  const setMainView = useLayoutStore((s) => s.setMainView);

  const pick = async (id: string) => {
    await openSession(id);
    setMainView('learn-session');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <PageHeader icon="academic-cap" title="主题学习">
        <span className="text-[11px] text-fg-faint">全部学习记录 · 共 {sessions.length} 个</span>
      </PageHeader>
      <div className="flex-1 overflow-y-auto pt-14">
        <div className="max-w-5xl mx-auto px-8 py-6">
          <div className="mb-4">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors"
            >
              <Icon name="arrow-left" className="w-3.5 h-3.5" />
              返回
            </button>
          </div>
          {sessions.length === 0 ? (
            <div className="text-center text-fg-faint text-sm py-20">暂无学习记录</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {sessions.map((s) => (
                <RecordCard
                  key={s.id}
                  session={s}
                  onPick={(id) => void pick(id)}
                  onRemove={(id) => void removeSession(id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 页面容器（输入页） ============
export function LearnInputPage() {
  const { loadList, openSession } = useLearnStore();
  const setMainView = useLayoutStore((s) => s.setMainView);
  const [viewAll, setViewAll] = useState(false);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 查看全部记录（宫格卡片视图）
  if (viewAll) {
    return <AllRecordsView onBack={() => setViewAll(false)} />;
  }

  const pick = async (id: string) => {
    await openSession(id);
    setMainView('learn-session');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <PageHeader icon="academic-cap" title="主题学习">
        <span className="text-[11px] text-fg-faint">AI 拆解主题、生成系列学习文章</span>
      </PageHeader>

      <div className="flex-1 overflow-y-auto pt-14">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
          <LearnForm />
          <HistoryList
            onPick={(id) => void pick(id)}
            onShowAll={() => setViewAll(true)}
          />
        </div>
      </div>
    </div>
  );
}
