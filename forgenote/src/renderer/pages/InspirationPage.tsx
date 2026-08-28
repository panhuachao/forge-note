// 灵感页面：基于当前知识库，提供补充/完善思路、补全思维缺陷、延伸案例，
// 帮助用户发现自己没想到的角度，了解更多。
import { useEffect, useMemo, useState } from 'react';
import { useKBStore, requireAI } from '../stores/kb-store';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { renderMarkdownPreview } from '../utils/markdown-preview';

// 隔离动态 markdown DOM 的子组件：以 html 作为 key，使 React 在内容变化时
// 整体卸载/重建该子树，避免 dangerouslySetInnerHTML 内容被浏览器重排后
// 与 React 虚拟树不一致，引发 removeChild 报错。
function MarkdownBlock({ html }: { html: string }) {
  return (
    <div
      key={html}
      className="markdown-preview inspiration-md w-full"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// 灵感方向：每种模式对应一组侧重提示
interface InspirationMode {
  key: string;
  icon: string;
  title: string;
  desc: string;
  prompt: string;
}

export function InspirationPage() {
  const { activeKb, aiConfig } = useKBStore();
  const [topic, setTopic] = useState('');
  const [modeKey, setModeKey] = useState<string>('blindspot');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [modes, setModes] = useState<InspirationMode[]>([]);
  const [dailyInsightPrompt, setDailyInsightPrompt] = useState('');
  const [lastAction, setLastAction] = useState<'generate' | 'dailyInsight' | null>(null);
  // 从高级设置读取固定的灵感提示词（持久化配置）
  useEffect(() => {
    window.forge.ai.getPrompts().then((p) => {
      setModes(p.inspirationModes as InspirationMode[]);
      setDailyInsightPrompt(p.dailyInsight);
      setModeKey((k) => p.inspirationModes.some((m) => m.key === k) ? k : (p.inspirationModes[0]?.key ?? ''));
    });
  }, []);

  // 渲染结果 Markdown（与笔记预览一致）。用 dangerouslySetInnerHTML 交由 React 管理
  // DOM 生命周期，避免手动 innerHTML 与 React 协调冲突导致 removeChild 报错。
  const resultHtml = useMemo(
    () => renderMarkdownPreview(result || '', activeKb?.id || '', ''),
    [result, activeKb?.id]
  );

  const mode = useMemo(
    () => modes.find((m) => m.key === modeKey) ?? modes[0],
    [modes, modeKey]
  );
  const aiEnabled = activeKb && aiConfig && aiConfig.provider !== 'none' && !!aiConfig.model;

  const buildPrompt = () => {
    const scope = topic.trim()
      ? `我当前关注的议题/想法是：「${topic.trim()}」。`
      : '我从整体知识库出发，没有指定具体议题。';
    return `${scope}\n\n${mode.prompt}\n\n要求：\n1) 严格基于知识库内容，引用笔记用 [[笔记名]]。\n2) 使用中文、分点清晰，可带小标题。\n3) 本地资料不足时明确说「本地未找到相关内容」，不要编造。`;
  };

  const generate = async () => {
    if (!activeKb || !aiEnabled) {
      requireAI();
      setError('请先在「设置」中配置可用的 AI 模型（provider / model / apiKey）。');
      return;
    }
    setLastAction('generate');
    setLoading(true);
    setError('');
    try {
      // 阶段 C：走 inspirer Agent（跨域 / 反常识 / 知识库缝隙 / 历史去重）
      const resp = await window.forge.ai.runAgent(activeKb.id, 'inspirer', buildPrompt(), { mode: mode.key });
      const ans = typeof resp === 'string' ? resp : (resp?.text ?? resp?.content ?? '');
      setResult(ans || '（AI 未返回内容）');
    } catch (e) {
      setError(String(e));
      setResult('');
    } finally {
      setLoading(false);
    }
  };

  
  const buildDailyInsightQuestion = () => {
    return [
      '【每天灵感一现】',
      '',
      '硬性约束：',
      '1) 禁止输出"完成比完美更重要""先行动再优化""自律改变命运"这类随处可见的鸡汤式答案；',
      '2) 给出的认知必须有真实出处、可查证，而非泛泛而谈；',
      '3) 必须贴合我知识库的主题领域，不要天马行空跑题；',
      '4) 仍然满足用户下方的具体要求。',
      '',
      '用户要求：',
      dailyInsightPrompt
    ].join('\n');
  };

  const dailyInsight = async () => {
    if (!activeKb || !aiEnabled) {
      requireAI();
      setError('请先在「设置」中配置可用的 AI 模型（provider / model / apiKey）。');
      return;
    }
    setLastAction('dailyInsight');
    setLoading(true);
    setError('');
    try {
      // 阶段 C：走 daily-muse Agent（禁母题 / 历史去重 / 跨域 / 高温度）
      const resp = await window.forge.ai.runAgent(activeKb.id, 'daily-muse', buildDailyInsightQuestion());
      const ans = typeof resp === 'string' ? resp : (resp?.text ?? resp?.content ?? '');
      setResult(ans || '（AI 未返回内容）');
    } catch (e) {
      setError(String(e));
      setResult('');
    } finally {
      setLoading(false);
    }
  };

  const saveAsNote = () => {
    if (!activeKb || !result.trim()) return;
    const actionLabel = lastAction === 'dailyInsight' ? '每天灵感一现' : mode.title;
    const title = `灵感-${actionLabel}-${new Date().toISOString().slice(0, 10)}`;
    // 预填充：带元数据的完整内容，交给快速笔记弹窗（AI 自动整理标题/目录/标签/链接）
    const content = `---\ntitle: ${title}\nsource: inspiration\ntags: [灵感]\n---\n\n# ${mode.title}：${topic.trim() || '基于知识库的灵感'}\n\n> 方向：${mode.desc}\n\n${result}\n`;
    window.dispatchEvent(
      new CustomEvent('forgenote:open-quicknote', { detail: { content } })
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      {/* 公共标题栏：贯通窗口顶部 */}
      <PageHeader icon="light-bulb" title="灵感工坊">
        <span className="text-[11px] text-fg-faint">
          基于「{activeKb?.name || '当前知识库'}」延伸你的思路
        </span>
      </PageHeader>

      <div className="flex-1 flex overflow-hidden pt-14">
        {/* 左：灵感方向 + 话题输入 */}
        <div className="w-72 shrink-0 border-r border-border-soft bg-canvas p-4 flex flex-col gap-4 overflow-y-auto">
          <button
            onClick={dailyInsight}
            disabled={loading || !aiEnabled}
            className="w-full h-10 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-hover text-brand-fg text-sm font-medium shadow-[0_2px_10px_-2px_rgba(220,38,38,0.35)] hover:shadow-[0_4px_14px_-2px_rgba(220,38,38,0.45)] transition-all disabled:opacity-50"
          >
            <Icon name="sparkles" className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
            每天灵光一现
          </button>

          <div>
            <div className="text-xs font-medium text-fg-muted mb-1.5">选择灵感方向</div>
            <div className="flex flex-col gap-2">
              {modes.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setModeKey(m.key)}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    modeKey === m.key
                      ? 'border-brand bg-brand-soft shadow-[0_2px_8px_-2px_rgba(220,38,38,0.18)]'
                      : 'border-border-soft hover:bg-hover-bg'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
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
          </div>

          <div>
            <div className="text-xs font-medium text-fg-muted mb-1.5">
              我想深入的议题 / 当前想法（可选）
            </div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={4}
              placeholder="留空则基于整个知识库发散；也可描述你的思路，让 AI 补全盲区与延伸案例。"
              className="w-full px-3 py-2 text-xs rounded-xl border border-border-soft bg-content text-fg resize-none outline-none focus:border-brand transition-colors"
            />
          </div>

          <button
            onClick={generate}
            disabled={loading || !aiEnabled}
            className="w-full h-10 flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-fg font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
          >
            <Icon name="sparkles" className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
            {loading ? '生成中…' : '生成灵感'}
          </button>
          {!aiEnabled && (
            <div className="text-[11px] text-amber-500 leading-relaxed">
              未检测到可用 AI 模型，请前往「设置」配置 provider / model / apiKey。
            </div>
          )}
        </div>

        {/* 右：灵感流（白底内容卡片） */}
        <div className="flex-1 flex flex-col overflow-hidden bg-content">
          {error && (
            <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 border-b border-border-soft">
              {error}
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {result ? (
              <div key="insp-result" className="w-full max-w-4xl mx-auto">
                {/* 内容卡片 */}
                <div className="rounded-2xl border border-border-soft bg-content shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
                  {/* 头部：徽章 + mode + 字数 + 保存 */}
                  <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border-soft bg-canvas/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-soft text-brand text-[11px] font-medium shrink-0">
                        <Icon name="sparkles" className="w-3 h-3" />
                        灵感结果
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-canvas border border-border-soft text-fg-muted text-[11px] shrink-0">
                        <Icon name={lastAction === 'dailyInsight' ? 'sun' : mode.icon as any} className="w-3 h-3" />
                        {lastAction === 'dailyInsight' ? '每天灵感一现' : mode.title}
                      </span>
                      <span className="text-[11px] text-fg-faint shrink-0">
                        {result.length} 字
                      </span>
                    </div>
                    <button
                      onClick={saveAsNote}
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-colors shrink-0 bg-brand text-brand-fg hover:bg-brand-hover"
                      title="打开快速笔记并自动填充，AI 帮你整理归档"
                    >
                      <Icon name="document-plus" className="w-3.5 h-3.5" />
                      存为笔记
                    </button>
                  </div>
                  {/* 正文 */}
                  <div className="px-8 py-6">
                    <MarkdownBlock html={resultHtml} />
                  </div>
                </div>
                {/* 底部：操作提示 */}
                <div className="mt-3 text-[11px] text-fg-faint text-center">
                  点击「存为笔记」可在快速笔记弹窗中编辑整理，再一键归入知识库
                </div>
              </div>
            ) : (
              <div key="insp-empty" className="h-full flex flex-col items-center justify-center text-center px-8">
                <div className="relative mb-6">
                  <div className="absolute inset-0 rounded-3xl bg-brand/10 blur-xl" />
                  <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(220,38,38,0.4)]">
                    <Icon name="light-bulb" className="w-10 h-10 text-white" />
                  </div>
                </div>
                <div className="text-base font-medium text-fg mb-2">从知识库延伸你的思路</div>
                <div className="text-xs text-fg-muted max-w-md leading-relaxed mb-6">
                  选择左侧灵感方向，描述你正在思考的议题（可选），点击「生成灵感」即可获得
                  思维盲区、补充思路、延伸案例或换角度的发散结果。
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {modes.map((m) => (
                    <span
                      key={m.key}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-canvas border border-border-soft text-[11px] text-fg-muted"
                    >
                      <Icon name={m.icon as any} className="w-3 h-3 text-fg-faint" />
                      {m.title}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
