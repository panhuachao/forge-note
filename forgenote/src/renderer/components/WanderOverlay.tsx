// 闲逛浮层：让 AI（wander agent）在现有知识库材料里，把分散的笔记片段重新组合，
// 产出 3 个新的价值知识点（旧知识的新组合）。每个洞察底部显示关联的源笔记作为依据。
import { useEffect, useMemo, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import { resolveWikiLink } from '../utils/wikilink';
import { Icon } from './Icon';
import type { TreeNode } from '@shared/types';

interface Insight {
  title: string;
  bodyHtml: string;
  sources: string[]; // 去重后的源笔记名（来自 [[笔记名]]）
}

function flattenFiles(node: TreeNode, out: { path: string; name: string }[] = []): { path: string; name: string }[] {
  if (node.kind === 'file') {
    out.push({ path: node.path, name: node.name });
    return out;
  }
  if (node.children) for (const c of node.children) flattenFiles(c, out);
  return out;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// 从文本中提取 [[笔记名]]（去 .md 后缀、去重）
function extractWikiNames(text: string): string[] {
  const set = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    set.add(m[1].replace(/\.md$/i, '').trim());
  }
  return [...set];
}

function parseInsights(md: string): Insight[] {
  let text = md.trim();
  // 1) 去除可能包裹整个返回的外层代码块围栏（模型常把整体输出包在 ```markdown...``` 里）
  const fenceAll = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenceAll) text = fenceAll[1];

  // 2) 优先按 ## 切分；若没有，再按 ### 切分
  const reDouble = /^##\s+/m;
  const reTriple = /^###\s+/m;
  let parts: string[] = [];
  if (reDouble.test(text)) {
    parts = text.split(/^##\s+/m).slice(1);
  } else if (reTriple.test(text)) {
    parts = text.split(/^###\s+/m).slice(1);
  } else {
    // 3) 结构化失败：把整段当成一个 raw 洞察，便于用户看到 AI 真实输出 + 排查
    console.warn('[wander] 未识别到 ## / ### 标题分隔，原始输出:\n', text);
    return [{
      title: 'AI 自由输出（未按约定结构）',
      bodyHtml: renderMarkdownPreview(text, useKBStore.getState().activeKb?.id || '', ''),
      sources: extractWikiNames(text),
    }];
  }
  return parts.slice(0, 3).map((p) => {
    const lines = p.split('\n');
    const title = lines.shift()?.trim() || '未命名洞察';
    const body = lines.join('\n').trim();
    return {
      title,
      bodyHtml: renderMarkdownPreview(body, useKBStore.getState().activeKb?.id || '', ''),
      sources: extractWikiNames(body),
    };
  });
}

export function WanderOverlay() {
  const wanderOpen = useLayoutStore((s) => s.wanderOpen);
  const closeWander = useLayoutStore((s) => s.closeWander);
  const openTab = useLayoutStore((s) => s.openTab);
  const setMainView = useLayoutStore((s) => s.setMainView);

  const { activeKb, tree } = useKBStore();

  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allFiles = useMemo(() => (tree ? flattenFiles(tree) : []), [tree]);

  const runWander = async () => {
    if (!activeKb || allFiles.length === 0) return;
    setLoading(true);
    setError('');
    try {
      // 1) 随机抽若干篇笔记作为"漫游材料"
      const picks = pickRandom(allFiles, Math.min(10, allFiles.length));
      const materials = await Promise.all(
        picks.map(async (p) => {
          try {
            const note = await window.forge.fs.readNote(activeKb.id, p.path);
            const body = note.content.replace(/^---\n[\s\S]*?\n---\n?/, '').slice(0, 1500);
            const name = (typeof note.frontmatter.title === 'string' ? note.frontmatter.title : p.name).replace(/\.md$/i, '');
            return `### 笔记：${name}\n${body}`;
          } catch {
            return '';
          }
        })
      );
      const joined = materials.filter(Boolean).join('\n\n');
      const prompt = `以下是当前知识库的部分笔记材料，请在其中漫游，把不同笔记的片段重新组合，产出 3 个新的价值知识点：\n\n${joined}`;

      // 2) 调用 wander agent（材料已在 prompt 中，retrieval 关闭避免重复）
      const resp = await window.forge.ai.runAgent(activeKb.id, 'wander', prompt, {});
      const text = typeof resp === 'string' ? resp : (resp?.text ?? resp?.content ?? '');
      if (!text) {
        setError('AI 未返回内容，请稍后重试');
        return;
      }
      const parsed = parseInsights(text);
      // parseInsights 永远返回至少 1 个元素（结构化失败时回退为 raw 卡片）
      setInsights(parsed);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // 打开时自动跑一组
  useEffect(() => {
    if (!wanderOpen) {
      setInsights([]);
      setError('');
      return;
    }
    if (allFiles.length === 0) return;
    runWander();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanderOpen, activeKb?.id, allFiles.length]);

  // Esc 关闭
  useEffect(() => {
    if (!wanderOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWander();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wanderOpen, closeWander]);

  if (!wanderOpen) return null;

  const openSource = async (name: string) => {
    const path = await resolveWikiLink(name);
    if (path) {
      openTab(path);
      setMainView('note');
      closeWander();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-16 px-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeWander();
      }}
    >
      <div
        className="w-full max-w-5xl bg-canvas rounded-2xl shadow-2xl border border-border-soft overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-soft">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-soft text-brand flex items-center justify-center">
              <Icon name="sparkles" className="w-5 h-5" solid />
            </div>
            <div>
              <h2 className="text-base font-semibold text-fg leading-tight">闲逛知识库</h2>
              <p className="text-xs text-fg-muted mt-0.5">
                AI 在现有笔记间漫游，组合出 3 个新的价值知识点
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runWander}
              disabled={loading || allFiles.length === 0}
              className="group h-9 px-3 rounded-lg border border-border-soft text-fg-muted hover:text-fg hover:bg-hover-bg text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <Icon name="arrow-path" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              换一组
            </button>
            <button
              onClick={closeWander}
              title="关闭（Esc）"
              className="w-9 h-9 rounded-lg text-fg-muted hover:text-fg hover:bg-hover-bg flex items-center justify-center"
            >
              <Icon name="x-mark" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-6">
          {allFiles.length === 0 ? (
            <div className="py-20 text-center text-fg-muted text-sm">当前知识库还没有笔记</div>
          ) : loading && insights.length === 0 ? (
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={`skel-${i}`} className="rounded-xl border border-border-soft bg-content p-5 min-h-[320px] animate-pulse">
                  <div className="h-4 w-2/3 bg-hover-bg rounded mb-3" />
                  <div className="h-3 w-1/3 bg-hover-bg rounded mb-5" />
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-hover-bg rounded" />
                    <div className="h-3 w-5/6 bg-hover-bg rounded" />
                    <div className="h-3 w-4/6 bg-hover-bg rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="py-20 text-center text-fg-muted text-sm">
              {error}
              <div className="mt-3">
                <button
                  onClick={runWander}
                  className="text-brand hover:underline text-sm"
                >
                  重试
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {insights.map((ins, i) => (
                <article
                  key={i}
                  className="rounded-xl border border-border-soft bg-content hover:border-brand/50 transition-all flex flex-col min-h-[320px] overflow-hidden"
                >
                  <div className="flex-1 p-5 flex flex-col">
                    <div className="flex items-center gap-1.5 text-[11px] text-fg-faint mb-2">
                      <Icon name="sparkles" className="w-3.5 h-3.5 text-brand" />
                      新组合洞察
                    </div>
                    <h3 className="text-sm font-semibold text-fg leading-snug mb-3">{ins.title}</h3>
                    <div
                      className="markdown-preview text-xs text-fg-secondary leading-relaxed overflow-hidden"
                      style={{ display: '-webkit-box', WebkitLineClamp: 12, WebkitBoxOrient: 'vertical' }}
                      dangerouslySetInnerHTML={{ __html: ins.bodyHtml }}
                    />
                  </div>
                  {/* 依据：关联源笔记 */}
                  <div className="px-5 py-3 border-t border-border-soft">
                    <div className="text-[10px] uppercase tracking-wide text-fg-faint mb-1.5">依据笔记</div>
                    {ins.sources.length === 0 ? (
                      <span className="text-[11px] text-fg-faint">（未标注来源）</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {ins.sources.map((s) => (
                          <button
                            key={s}
                            onClick={() => openSource(s)}
                            title={`跳转到「${s}」`}
                            className="px-2 py-0.5 text-[11px] rounded-full bg-brand-soft text-brand hover:bg-brand/20 transition-colors"
                          >
                            [[{s}]]
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border-soft text-[11px] text-fg-faint flex items-center justify-between">
          <span>每次从 {Math.min(10, allFiles.length)} 篇随机材料中组合</span>
          <span>共 {allFiles.length} 篇可漫游</span>
        </div>
      </div>
    </div>
  );
}