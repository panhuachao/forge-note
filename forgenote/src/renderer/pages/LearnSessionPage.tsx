// 主题学习 · 学习页面（阅读视图）
// 进入条件：learn-store 的 active 已设置为某次会话。从输入页点历史 / 生成完成后跳转至此。
//
// 数据流（刻意保持最简，不做任何文章级缓存）：
//   点击文章 → IPC 让后端读对应 .md → 返回正文 → 渲染成 HTML → 展示
//   展示完即被下一次点击替换，交由 GC 回收，渲染进程内不驻留历史文章。
//
// 内存安全约束（曾因违反导致渲染进程 OOM 被杀，勿回退）：
// - 不缓存「原文 / 已渲染 HTML」：这两者体积可达数百 KB / 篇，缓存会在反复切换与多会话后
//   持续堆积，是渲染进程内存增长的主因；
// - 不做后台预取、不做延迟排队解析：任意时刻只有「当前选中文章」的 1 次 IPC + 1 次同步解析，
//   解析即用即弃；切走 / 卸载后由 effect cleanup 标记丢弃迟到的结果，杜绝任务无限堆积。
import { useEffect, useRef, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLearnStore } from '../stores/learn-store';
import { useLayoutStore } from '../stores/layout-store';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import { type LearningSession } from '@shared/types/learn';

// ==================== [LearnDbg] 排查日志（用于定位重复执行 / 泄漏，定位完成后请删除或置 DEBUG=false） ====================
const DEBUG = false;
let dbgClock = 0; // 全局事件序号：数“已发生多少事件”，若快速放大说明存在重复/循环
let dbgViewSeq = 0; // LearnSessionView 实例唯一序号
let dbgPageSeq = 0; // LearnSessionPage 实例唯一序号
const dbg = (uid: string, msg: string, ...args: unknown[]) => {
  if (!DEBUG) return;
  console.log(
    `[LearnDbg][${String(dbgClock++).padStart(5, '0')}][${performance.now().toFixed(1)}ms][${uid}] ${msg}`,
    ...args
  );
};
// ====================================================================

// 隔离动态 markdown DOM 的子组件：key 用稳定 id，整体 remount，避免 React 对比几万字符的 HTML
function MarkdownBlock({ html }: { html: string }) {
  const prevHtml = useRef<string | null>(null);
  if (prevHtml.current !== html) {
    dbg('mdblock', `html ${prevHtml.current === null ? '首次注入' : '更新'} ${prevHtml.current?.length ?? 0}B -> ${html.length}B`);
    prevHtml.current = html;
  }
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

  // 当前文章的原文 / 已渲染 HTML / 加载态
  // 不做任何文章级缓存：每次点击都重新向后端取正文并渲染，渲染完即被替换、交由 GC 回收。
  // 这是为了避免「原文 + HTML」在渲染进程里长期驻留累积。
  const [articleContent, setArticleContent] = useState('');
  const [articleHtml, setArticleHtml] = useState('');
  const [loadingArticle, setLoadingArticle] = useState(false);

  const kbId = activeKb?.id || '';

  // ===== [LearnDbg] 实例级追踪 =====
  const uid = useRef(`view${++dbgViewSeq}`).current; // 本组件实例唯一编号：值若增大说明页面反复重建组件
  const renderNo = useRef(0);
  renderNo.current += 1;
  // 渲染心跳：只打印第 1 次与每 200 次，识别“高频重渲染”（死循环渲染时 renderNo 会快速上涨）
  if (renderNo.current === 1 || renderNo.current % 200 === 0) {
    dbg(uid, `render 心跳 #${renderNo.current} (loading=${loadingArticle}, content=${articleContent.length}B, html=${articleHtml.length}B)`);
  }
  // 依赖变化追踪：打印 effect 的四项依赖签名，能定位“是哪一次 render / 哪个依赖在抖动”
  const depsSig = `${session.id}|${safeArt?.id}|${safeArt?.file}|${kbId}`;
  const prevDepsSig = useRef('');
  if (prevDepsSig.current !== depsSig) {
    dbg(uid, `deps 变化: "${prevDepsSig.current}" -> "${depsSig}" @render#${renderNo.current}`);
    prevDepsSig.current = depsSig;
  }
  // 挂载 / 卸载追踪：连续 MOUNT 说明组件被反复新建（key 抖动 / 父级重挂载）
  useEffect(() => {
    const artTotal = session.modules.reduce((n, m) => n + m.articles.length, 0);
    dbg(uid, `MOUNT session=${session.id} modules=${session.modules.length} articles=${artTotal}`);
    return () => dbg(uid, 'UNMOUNT（若有挂起 IPC / 定时器未清，此处可见）');
  }, []);

  // 选中文章后按需加载 / 渲染；后端只读对应 .md，正文取回后同步渲染
  useEffect(() => {
    const artKey = safeArt ? `${safeArt.id}/${safeArt.file ?? ''}` : 'null';
    dbg(uid, `[load-effect] 触发 art=${artKey}`);
    if (!safeArt) {
      setArticleContent('');
      setArticleHtml('');
      setLoadingArticle(false);
      return;
    }
    let cancelled = false;
    setLoadingArticle(true);
    dbg(uid, '[load-effect] loading=true，清空旧内容');
    // 先清空旧内容并展示 loading 占位（避免闪现上一篇文章）
    setArticleContent('');
    setArticleHtml('');

    const file = safeArt.file;
    if (!file) {
      // 极少数情况（极早期文章或结构异常）：无 file 则无正文
      dbg(uid, '[load-effect] file 为空 -> 直接结束 loading');
      setLoadingArticle(false);
      return;
    }

    const t0 = performance.now();
    dbg(uid, `[ipc] -> getArticle(${session.id}, ${file})`);
    window.forge.learn
      .getArticle(session.id, file)
      .then((res) => {
        dbg(uid, `[ipc] <- resolve 耗时 ${(performance.now() - t0).toFixed(1)}ms, content=${res?.content?.length ?? 0}B`);
        if (cancelled) {
          dbg(uid, '[ipc] 迟到结果被丢弃(cancelled=true)');
          return;
        }
        try {
          const content = res?.content ?? '';
          // IPC 返回后立即同步解析并提交；不缓存、不排队，渲染完即弃。
          const t1 = performance.now();
          const html = renderMarkdownPreview(content, kbId, '');
          dbg(uid, `[render] markdown->html ${(performance.now() - t1).toFixed(1)}ms, content=${content.length}B -> html=${html.length}B`);
          if (cancelled) {
            dbg(uid, '[render] 渲染期间被取消(cancelled=true)');
            return;
          }
          // 原文与 HTML 一并提交，React 18 自动批处理，只触发一次渲染
          setArticleContent(content);
          setArticleHtml(html);
          dbg(uid, '[state] setArticleContent + setArticleHtml 提交完成');
        } catch (e) {
          dbg(uid, `[render] 异常: ${String(e)}`);
          console.error('[Learn] markdown render failed:', e);
        } finally {
          if (!cancelled) setLoadingArticle(false);
        }
      })
      .catch((e) => {
        dbg(uid, `[ipc] reject: ${String(e)}`);
        if (!cancelled) {
          setArticleContent('');
          setArticleHtml('');
          setLoadingArticle(false);
        }
      });

    return () => {
      // 已切走 / 卸载：丢弃迟到的 IPC 结果，避免过期内容覆盖当前选中的文章
      dbg(uid, '[load-effect] cleanup：cancelled=true（若相邻日志密集出现，说明 effect 被反复重启）');
      cancelled = true;
    };
    // 依赖只保留决定「读哪个文件、用哪个 kb 渲染」的最小集合。
    // 不再依赖 session.modules（数组引用）与函数引用，避免无关重渲染反复触发本 effect。
  }, [session.id, safeArt?.id, safeArt?.file, kbId]);

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

  // ===== [LearnDbg] 页面级挂载追踪：判断页面是否被反复挂载/卸载 =====
  const pageUid = useRef(`page${++dbgPageSeq}`).current;
  useEffect(() => {
    dbg(pageUid, `MOUNT active=${active?.id ?? 'null'}`);
    return () => dbg(pageUid, `UNMOUNT active=${active?.id ?? 'null'}`);
  }, []);

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