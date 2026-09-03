// 主题学习 · 学习页面（阅读视图）
// 进入条件：learn-store 的 active 已设置为某次会话。从输入页点历史 / 生成完成后跳转至此。
//
// 性能要点（点击切换文章不卡顿）：
// 1) 会话结构（模块 / 文章元信息）一次取齐，正文按需取 — 后端 getArticle 只读对应 .md，
//    并有进程级 LRU 兜底二次访问零 IO。
// 2) 渲染层 articleCache 同时缓存「原文 + 已渲染 HTML」，再次点击同一篇命中即 0 IPC / 0 解析。
// 3) markdown 解析交给 requestIdleCallback（无则 setTimeout 兜底），避免在主线程同步阻塞长文解析。
// 4) 渲染完成后在空闲时段预取下一篇 / 上下一篇，下次点击几乎瞬开。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLearnStore } from '../stores/learn-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import { type LearningSession, type LearnArticle } from '@shared/types/learn';

// 进程级 / 跨组件的渲染辅助：将 markdown 解析推迟到 idle / 下一帧，避免阻塞主线程
function scheduleIdle(cb: () => void, timeout = 120): void {
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined;
  if (ric) ric(cb, { timeout });
  else setTimeout(cb, 0);
}

// 隔离动态 markdown DOM 的子组件：key 用稳定 id，整体 remount，避免 React 对比几万字符的 HTML
function MarkdownBlock({ html }: { html: string }) {
  return (
    <div
      className="markdown-preview learning-md w-full"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ============ 主题学习页（生成完成后展示） ============
function LearnSessionView({ session }: { session: LearningSession }) {
  const { activeKb } = useKBStore();
  const [selMod, setSelMod] = useState(0);
  const [selArt, setSelArt] = useState(0);

  const safeMod = session.modules.length
    ? session.modules[Math.min(selMod, session.modules.length - 1)]
    : null;
  const safeArt =
    safeMod && safeMod.articles.length
      ? safeMod.articles[Math.min(selArt, safeMod.articles.length - 1)]
      : null;

  // 渲染层缓存：articleId → { content, html }
  // 命中时整篇文章零开销（不再 IPC、不再 markdown 解析、不再 React 文本 diff）
  const articleCache = useRef<Map<string, { content: string; html: string }>>(new Map());

  // 当前文章的原文 / 已渲染 HTML / 加载态
  const [articleContent, setArticleContent] = useState('');
  const [articleHtml, setArticleHtml] = useState('');
  const [loadingArticle, setLoadingArticle] = useState(false);

  const kbId = activeKb?.id || '';

  // 顺序预取：当前文章加载完 → 在空闲时段预取下一篇 / 上上一篇的原文
  const prefetch = useMemo(
    () => async (article: LearnArticle | null) => {
      if (!article || !article.file) return;
      if (articleCache.current.has(article.id)) return;
      try {
        const res = await window.forge.learn.getArticle(session.id, article.file);
        if (!res?.content) return;
        const html = renderMarkdownPreview(res.content, kbId, '');
        articleCache.current.set(article.id, { content: res.content, html });
      } catch {
        /* 预取失败不影响主路径 */
      }
    },
    [session.id, kbId]
  );

  // 选中文章后按需加载 / 渲染；后端只读对应 .md + 命中 LRU 缓存，markdown 解析走 idle
  useEffect(() => {
    if (!safeArt) {
      setArticleContent('');
      setArticleHtml('');
      setLoadingArticle(false);
      return;
    }
    const cached = articleCache.current.get(safeArt.id);
    if (cached) {
      // 命中缓存：同步设置，无 IPC、无 markdown 解析
      setArticleContent(cached.content);
      setArticleHtml(cached.html);
      setLoadingArticle(false);
      return;
    }

    let cancelled = false;
    setLoadingArticle(true);
    // 缓存未命中：先展示 loading 占位（避免闪现旧文章）
    setArticleContent('');
    setArticleHtml('');

    const file = safeArt.file;
    if (!file) {
      // 极少数情况（极早期文章或结构异常）：无 file 则无正文
      setLoadingArticle(false);
      return;
    }

    window.forge.learn
      .getArticle(session.id, file)
      .then((res) => {
        if (cancelled) return;
        const content = res?.content ?? '';
        setArticleContent(content);
        // 异步渲染 markdown：让主线程先处理点击反馈、滚动等，避免长文解析卡顿
        scheduleIdle(() => {
          if (cancelled) return;
          try {
            const html = renderMarkdownPreview(content, kbId, '');
            if (cancelled) return;
            articleCache.current.set(safeArt.id, { content, html });
            setArticleHtml(html);
          } catch (e) {
            console.error('[Learn] markdown render failed:', e);
          } finally {
            if (!cancelled) setLoadingArticle(false);
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setArticleContent('');
          setLoadingArticle(false);
        }
      });

    // 当前文章准备完成后，顺手预取下一篇 / 上一篇，让连续点击顺滑
    const allArticles = session.modules.flatMap((m) => m.articles);
    const curIdx = allArticles.findIndex((a) => a.id === safeArt.id);
    const next = curIdx >= 0 ? allArticles[curIdx + 1] : null;
    const prev = curIdx > 0 ? allArticles[curIdx - 1] : null;
    scheduleIdle(() => {
      if (cancelled) return;
      void prefetch(next);
      void prefetch(prev);
    });

    return () => {
      cancelled = true;
    };
  }, [session.id, safeArt?.id, safeArt?.file, kbId, session.modules, prefetch]);

  const addToNote = () => {
    if (!safeArt) return;
    const body = articleContent || safeArt.content || '';
    const note = `# ${safeArt.title}\n\n> 来自主题学习：「${session.topic}」 · 模式：${session.modeTitle}\n\n${body}`;
    window.dispatchEvent(new CustomEvent('forgenote:open-quicknote', { detail: { content: note } }));
  };

  const back = () => {
    useLearnStore.getState().clearActive();
    useLayoutStore.getState().setMainView('learn');
  };

  if (session.modules.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-content">
        <div className="px-6 py-3 border-b border-border-soft bg-canvas/40 flex items-center gap-2">
          <button onClick={back} className="text-xs text-fg-muted hover:text-fg flex items-center gap-1">
            <Icon name="arrow-left" className="w-3.5 h-3.5" />
            返回
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <Icon name="academic-cap" className="w-12 h-12 text-fg-faint mb-3" />
          <div className="text-sm text-fg-muted mb-1">本次学习尚未生成内容</div>
          {session.status === 'error' && session.error && (
            <div className="text-xs text-red-500 max-w-md">{session.error}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-content">
      {/* 左：模块 / 文章导航 */}
      <div className="w-72 shrink-0 border-r border-border-soft bg-canvas overflow-y-auto py-3">
        <div className="px-4 pb-2 flex items-center gap-1.5">
          <button onClick={back} className="text-[11px] text-fg-muted hover:text-fg flex items-center gap-1">
            <Icon name="arrow-left" className="w-3 h-3" />
            返回
          </button>
        </div>
        <div className="px-4 pb-2 text-[11px] uppercase tracking-wider text-fg-faint">
          学习大纲 · {session.topic}
        </div>
        {session.modules.map((m, mi) => (
          <div key={m.id} className="mb-1">
            <button
              onClick={() => { setSelMod(mi); setSelArt(0); }}
              className={`w-full text-left px-4 py-1.5 text-sm font-medium flex items-center gap-2 ${
                selMod === mi ? 'text-brand' : 'text-fg hover:bg-hover-bg'
              }`}
            >
              <Icon name="folder-open" className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{m.title}</span>
            </button>
            <div className="pl-7">
              {m.articles.map((a, ai) => (
                <button
                  key={a.id}
                  onClick={() => { setSelMod(mi); setSelArt(ai); }}
                  className={`w-full text-left px-3 py-1 text-[12px] rounded-lg truncate ${
                    selMod === mi && selArt === ai
                      ? 'bg-brand-soft text-brand'
                      : 'text-fg-muted hover:bg-hover-bg'
                  }`}
                  title={a.title}
                >
                  {a.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 右：文章预览 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-border-soft bg-canvas/40">
          <div className="min-w-0">
            <div className="text-[11px] text-fg-faint truncate">
              {safeMod?.title} · 模式：{session.modeTitle}
            </div>
            <div className="text-sm font-medium text-fg truncate">{safeArt?.title}</div>
          </div>
          <button
            onClick={addToNote}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-colors shrink-0 bg-brand text-brand-fg hover:bg-brand-hover"
            title="打开快速笔记并预填，AI 帮你整理归档"
          >
            <Icon name="document-plus" className="w-3.5 h-3.5" />
            添加到笔记
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="w-full max-w-4xl mx-auto">
            <div className="rounded-2xl border border-border-soft bg-content shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="px-8 py-6 relative min-h-[160px]">
                {!safeArt ? (
                  <div className="text-sm text-fg-faint">请选择左侧文章</div>
                ) : loadingArticle ? (
                  <div className="text-sm text-fg-faint flex items-center gap-2">
                    <Icon name="arrow-path" className="w-3.5 h-3.5 animate-spin text-brand" />
                    加载中…
                  </div>
                ) : (
                  // 用 stable id 作为 key，整体 remount，避免对比几万字符的 HTML 字符串
                  <MarkdownBlock key={safeArt.id} html={articleHtml} />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-border-soft bg-canvas/40">
                <span className="text-[11px] text-fg-faint">
                  觉得有用？一键转存为知识库笔记
                </span>
                <button
                  onClick={addToNote}
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-colors bg-brand text-brand-fg hover:bg-brand-hover"
                >
                  <Icon name="document-plus" className="w-3.5 h-3.5" />
                  添加到笔记
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 页面容器（学习页） ============
export function LearnSessionPage() {
  const { active } = useLearnStore();
  const setMainView = useLayoutStore((s) => s.setMainView);

  if (!active) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
        <PageHeader icon="academic-cap" title="主题学习">
          <span className="text-[11px] text-fg-faint">未选择学习会话</span>
        </PageHeader>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3">
          <Icon name="academic-cap" className="w-12 h-12 text-fg-faint" />
          <div className="text-sm text-fg-muted">没有正在阅读的学习会话</div>
          <button
            onClick={() => setMainView('learn')}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-colors bg-brand text-brand-fg hover:bg-brand-hover"
          >
            返回主题学习
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <PageHeader icon="academic-cap" title="主题学习">
        <span className="text-[11px] text-fg-faint">正在阅读：{active.topic}</span>
      </PageHeader>
      <div className="flex-1 flex overflow-hidden pt-14">
        {/* key=active.id：会话切换 / 删除时整体重建，渲染缓存自然失效 */}
        <LearnSessionView key={active.id} session={active} />
      </div>
    </div>
  );
}