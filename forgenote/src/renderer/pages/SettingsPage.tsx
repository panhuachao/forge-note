import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import type { ThemeColorKey } from '../stores/layout-store';
import type { AIModelConfig, AIPrompts, InspirationModePrompt, AIServiceProvider } from '@shared/types';
import { DEFAULT_AI_PROMPTS, AI_SERVICE_DEFAULTS, AI_SERVICE_MODELS } from '@shared/types/ai';
import type { UpdateStatus } from '@shared/ipc-channels';
import { PageHeader } from '../components/PageHeader';
import { UserProfilePanel } from '../components/UserProfilePanel';

type SettingsTab = 'basic' | 'advanced';

export function SettingsPage() {
  const { aiConfig, setAIConfig, pushToast, activeKb } = useKBStore();
  const { fontSize, lineHeight, themeColor, setFontSize, setLineHeight, setThemeColor } = useLayoutStore();
  const [cfg, setCfg] = useState<AIModelConfig>(aiConfig);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('basic');
  const [prompts, setPrompts] = useState<AIPrompts>(DEFAULT_AI_PROMPTS);
  const [promptsSaving, setPromptsSaving] = useState(false);
  // 阶段 C3：Agent 用户覆写（app_config['ai:agents']）
  const [agentOverride, setAgentOverride] = useState<string>(''); // daily-muse 的 systemPrompt 覆写
  const [agentOverrideSaving, setAgentOverrideSaving] = useState(false);

  // 进入设置页时从主进程重新拉取最新持久化配置（含外部 MCP 启用状态），
  // 避免因为 store 快照过期而显示过时的启用状态；同时用 cleanup 标记防止卸载后还 setState。
  useEffect(() => {
    let mounted = true;
    window.forge.ai.getConfig().then((remote) => {
      if (mounted && remote) setCfg(remote);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // 应用更新状态
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [autoCheck, setAutoCheck] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // 成本可观测：AI 调用用量（方案 §三.3）
  const [usage, setUsage] = useState<Record<string, { calls: number; tokens: number; ms: number }>>({});

  // 索引重建进度（见上文 “数据维护” section）；3 个按钮共用一个 in-flight 状态，避免并发
  const [rebuilding, setRebuilding] = useState<'tags' | 'meta' | 'chunks' | null>(null);
  // 更新说明弹窗
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);

  /**
   * 触发索引重建。空值/null 任务会被拒绝（按钮 disabled 已经挡了大部分情况）。
   * 重建后通过 pushToast 把影响条目数告诉用户，让 "我点了有用吗" 立刻有反馈。
   */
  async function rebuildIndex(kind: 'tags' | 'meta' | 'chunks') {
    if (!activeKb) {
      pushToast({ level: 'warn', text: '请先选择知识库' });
      return;
    }
    setRebuilding(kind);
    try {
      let count = 0;
      if (kind === 'tags') count = await window.forge.search.rebuildTags(activeKb.id);
      else if (kind === 'meta') count = await window.forge.search.rebuildMeta(activeKb.id);
      else count = await window.forge.search.rebuildChunks(activeKb.id);
      // 触发左面板“标签视图”刷新：把 KB 状态轻推一下，最简单的办法是重发一次 fs.listTags
      try {
        if (kind === 'tags' || kind === 'meta') {
          const tags = await window.forge.fs.listTags(activeKb.id);
          // 由 LeftPanel 自己监听 store，这里只是确保读取路径上都走到，避免缓存延迟
          if (Array.isArray(tags)) void tags.length;
        }
      } catch {
        /* 缓存读取失败不影响重建结果 */
      }
      pushToast({
        level: 'success',
        text:
          kind === 'tags'
            ? `已完成标签索引重建（${activeKb.name}，共 ${count} 条笔记）`
            : kind === 'meta'
            ? `已完成笔记 meta 重建（${activeKb.name}，共 ${count} 条）`
            : `已完成笔记分段重建（${activeKb.name}，共 ${count} 段）`
      });
    } catch (err) {
      pushToast({ level: 'error', text: `重建失败：${(err as Error)?.message ?? String(err)}` });
    } finally {
      setRebuilding(null);
    }
  }

  useEffect(() => {
    const app = window.forge.app;
    if (!app) return;
    app.getVersion().then(setVersion).catch(() => setVersion(''));
    const off = app.onUpdate((s) => {
      setUpdate(s);
      if (s.type === 'progress') setDownloading(true);
      if (s.type === 'downloaded') setDownloading(false);
    });
    return off;
  }, []);

  // 加载 AI 用量
  const loadUsage = () => {
    try {
      window.forge.ai.getUsage().then(setUsage).catch(() => setUsage({}));
    } catch {
      setUsage({});
    }
  };
  useEffect(() => {
    if (tab === 'advanced') loadUsage();
  }, [tab]);

  // 更新说明弹窗：ESC 关闭 + 锁定 body 滚动
  useEffect(() => {
    if (!showReleaseNotes) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowReleaseNotes(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [showReleaseNotes]);

  function handleCheck() {
    const app = window.forge.app;
    if (!app) return;
    setUpdate({ type: 'checking' });
    app.checkUpdate().catch((e) => setUpdate({ type: 'error', message: String(e) }));
  }

  function handleInstall() {
    const app = window.forge.app;
    if (!app) return;
    if (update?.type === 'downloaded') {
      // 已下载完成：直接退出并安装
      app.quitAndInstall().catch((e) => {
        setUpdate({ type: 'error', message: String(e) });
      });
      return;
    }
    setDownloading(true);
    app.installUpdate().catch((e) => {
      setDownloading(false);
      setUpdate({ type: 'error', message: String(e) });
    });
  }

  function handleToggleAuto(v: boolean) {
    const app = window.forge.app;
    setAutoCheck(v);
    app?.setAutoCheck(v).catch(() => {});
  }

  function updateStatusText(s: UpdateStatus | null) {
    if (!s) return '尚未检查';
    switch (s.type) {
      case 'checking': return '正在检查更新…';
      case 'available': return `发现新版本 v${s.version}`;
      case 'not-available': return `已是最新（v${s.version}）`;
      case 'progress': return `下载中 ${Math.round(s.percent)}%`;
      case 'downloaded': return `v${s.version} 已下载，点击重启安装`;
      case 'error': return `检查失败：${s.message}`;
    }
  }

  async function save() {
    setSaving(true);
    try {
      await window.forge.ai.setConfig(cfg);
      setAIConfig(cfg);
      pushToast({ level: 'success', text: 'AI 配置已保存' });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  /**
   * 静默保存当前 cfg（不弹成功 toast，失败时提示）。
   * 用于 MCP 启用开关等即时生效场景，确保勾选即持久化。
   */
  async function saveConfigSilently(nextCfg: AIModelConfig) {
    try {
      await window.forge.ai.setConfig(nextCfg);
      setAIConfig(nextCfg);
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  }

  // 加载高级设置中的固定提示词 + Agent 覆写（含旧 dailyInsight 迁移）
  useEffect(() => {
    window.forge.ai.getPrompts().then(setPrompts).catch(() => {});
    window.forge.ai.getAgentOverrides().then((ov) => {
      if (ov && ov['daily-muse']?.systemPrompt) setAgentOverride(ov['daily-muse'].systemPrompt);
    }).catch(() => {});
  }, []);

  function patchPrompt(p: Partial<AIPrompts>) {
    setPrompts((prev) => ({ ...prev, ...p }));
  }

  function patchMode(i: number, p: Partial<InspirationModePrompt>) {
    setPrompts((prev) => ({
      ...prev,
      inspirationModes: prev.inspirationModes.map((m, idx) => (idx === i ? { ...m, ...p } : m))
    }));
  }

  async function savePrompts() {
    setPromptsSaving(true);
    try {
      await window.forge.ai.setPrompts(prompts);
      pushToast({ level: 'success', text: '提示词配置已保存' });
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    } finally {
      setPromptsSaving(false);
    }
  }

  function resetPrompts() {
    setPrompts(DEFAULT_AI_PROMPTS);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <PageHeader icon="cog" title="设置" />
      <div className="flex-1 overflow-y-auto p-6 pt-20 space-y-6">
        {/* Tab 切换：基础设置 / 高级设置 */}
        <div className="flex items-center gap-2 w-fit">
          {(
            [
              { k: 'basic', label: '基础设置' },
              { k: 'advanced', label: '高级设置' }
            ] as { k: SettingsTab; label: string }[]
          ).map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-5 py-2 rounded-full text-sm transition-all ${
                tab === t.k
                  ? 'bg-brand-soft text-brand border border-brand/20'
                  : 'bg-content text-fg-secondary border border-border-soft hover:bg-hover-bg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'basic' && (
        <>
        <section className="bg-content rounded-xl border border-border-soft p-5">
          <h2 className="font-semibold mb-1">外观样式</h2>
          <p className="text-xs text-fg-muted mb-4">调整正文字体大小与行间距，实时生效并自动保存。</p>
          <div className="space-y-4 text-sm">
            <div>
              <label className="text-xs text-fg-muted">字体大小</label>
              <div className="mt-1.5 inline-flex rounded border border-border-soft overflow-hidden">
                {(['sm', 'md', 'lg'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFontSize(k)}
                    className={`px-4 py-1 text-sm ${fontSize === k ? 'bg-brand text-brand-fg' : 'text-fg-secondary hover:bg-hover-bg'}`}
                  >
                    {k === 'sm' ? '小' : k === 'md' ? '中' : '大'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-fg-muted">行间距</label>
              <div className="mt-1.5 inline-flex rounded border border-border-soft overflow-hidden">
                {(['sm', 'md', 'lg'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setLineHeight(k)}
                    className={`px-4 py-1 text-sm ${lineHeight === k ? 'bg-brand text-brand-fg' : 'text-fg-secondary hover:bg-hover-bg'}`}
                  >
                    {k === 'sm' ? '小' : k === 'md' ? '中' : '大'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-fg-muted">主题色</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(
                  [
                    { k: 'red', label: '红', color: '#ef4444' },
                    { k: 'blue', label: '深蓝', color: '#2563eb' },
                    { k: 'green', label: '绿', color: '#16a34a' },
                    { k: 'purple', label: '紫', color: '#7c3aed' },
                    { k: 'amber', label: '橙', color: '#d97706' },
                    { k: 'teal', label: '青', color: '#0d9488' }
                  ] as { k: ThemeColorKey; label: string; color: string }[]
                ).map((opt) => (
                  <button
                    key={opt.k}
                    onClick={() => setThemeColor(opt.k)}
                    title={opt.label}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${themeColor === opt.k ? 'ring-2 ring-offset-2 ring-brand scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: opt.color }}
                  >
                    {themeColor === opt.k && (
                      <span className="text-white text-sm leading-none">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <UserProfilePanel />

        <section className="bg-content rounded-xl border border-border-soft p-5">
          <h2 className="font-semibold mb-1">AI 模型配置</h2>
          <p className="text-xs text-fg-muted mb-4">
            选择模型服务商与默认模型。关闭后所有 AI 操作降级为本地规则引擎。
          </p>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-xs text-fg-muted">模型服务商</label>
              <select
                value={cfg.serviceProvider || 'none'}
                onChange={(e) => {
                  const sp = e.target.value as AIServiceProvider;
                  if (sp === 'none') {
                    setCfg({ ...cfg, provider: 'none', serviceProvider: 'none', model: '', baseUrl: '' });
                  } else {
                    const def = AI_SERVICE_DEFAULTS[sp];
                    setCfg({
                      ...cfg,
                      provider: def.protocol,
                      serviceProvider: sp,
                      baseUrl: def.baseUrl,
                      model: def.defaultModel
                    });
                  }
                }}
                className="input"
              >
                <option value="none">关闭（本地规则引擎降级）</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="moonshot">Moonshot</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
            {cfg.serviceProvider !== 'none' && (
              <>
                <div>
                  <label className="text-xs text-fg-muted">Base URL</label>
                  <input
                    value={cfg.baseUrl || ''}
                    onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                    className="input"
                    placeholder={AI_SERVICE_DEFAULTS[cfg.serviceProvider as Exclude<AIServiceProvider, 'none'>]?.baseUrl}
                  />
                  <p className="text-xs text-fg-faint mt-1">
                    默认地址：{AI_SERVICE_DEFAULTS[cfg.serviceProvider as Exclude<AIServiceProvider, 'none'>]?.baseUrl}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-fg-muted">默认模型</label>
                  {cfg.serviceProvider === 'ollama' ? (
                    <input
                      value={cfg.model || ''}
                      onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                      className="input"
                      placeholder="qwen2.5:7b"
                    />
                  ) : (
                    <select
                      value={cfg.model || ''}
                      onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                      className="input"
                    >
                      {AI_SERVICE_MODELS[cfg.serviceProvider as Exclude<AIServiceProvider, 'none'>].map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} {m.desc ? `— ${m.desc}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-xs text-fg-muted">API Key</label>
                  <input
                    type="password"
                    value={cfg.apiKey || ''}
                    onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                    className="input"
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-fg-faint mt-1">API Key 通过系统安全存储加密保存，不会上传。</p>
                </div>
              </>
            )}
            <div className="pt-2 flex justify-end">
              <button onClick={save} disabled={saving} className="btn btn-primary">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </section>

        {activeKb && (
          <section className="bg-content rounded-xl border border-border-soft p-5">
            <h2 className="font-semibold mb-1">知识库</h2>
            <p className="text-xs text-fg-muted mb-2">当前：{activeKb.name}</p>
            <p className="text-xs text-fg-muted break-all">路径：{activeKb.rootPath}</p>
          </section>
        )}

        <section className="bg-content rounded-xl border border-border-soft p-5">
          <h2 className="font-semibold mb-1">数据维护（重建索引）</h2>
          <p className="text-xs text-fg-muted mb-3">
            SQLite 中保存的标签 / 笔记元信息 / 分段索引可能在文件移动、删除后残留旧记录。
            可选择下方按钮按知识库逐一重建；重建在后台完成，安全且不影响正在编辑的笔记。
          </p>
          {!activeKb ? (
            <p className="text-xs text-fg-faint">当前未选择知识库，无法执行重建。</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                onClick={() => rebuildIndex('tags')}
                disabled={rebuilding !== null}
                className="btn flex flex-col items-start gap-1 py-2 text-left"
                title="清理已被删除文件的标签残留，按当前 FrontMatter 重新生成 note_meta.tags"
              >
                <span className="font-medium">重新构建标签记录</span>
                <span className="text-[11px] text-fg-muted">
                  {rebuilding === 'tags' ? '重建中…' : `适用：${activeKb.name}`}
                </span>
              </button>
              <button
                onClick={() => rebuildIndex('meta')}
                disabled={rebuilding !== null}
                className="btn flex flex-col items-start gap-1 py-2 text-left"
                title="清空 note_meta，重新提取 mtime / size / hash / summary / tags"
              >
                <span className="font-medium">重新构建笔记 meta</span>
                <span className="text-[11px] text-fg-muted">
                  {rebuilding === 'meta' ? '重建中…' : `适用：${activeKb.name}`}
                </span>
              </button>
              <button
                onClick={() => rebuildIndex('chunks')}
                disabled={rebuilding !== null}
                className="btn flex flex-col items-start gap-1 py-2 text-left"
                title="清空 note_chunks 后重新分段，用于 RAG 检索/AI 提示偶发不一致"
              >
                <span className="font-medium">重新构建笔记分段</span>
                <span className="text-[11px] text-fg-muted">
                  {rebuilding === 'chunks' ? '重建中…' : `适用：${activeKb.name}`}
                </span>
              </button>
            </div>
          )}
          {rebuilding && (
            <div className="mt-3 h-1.5 w-full rounded-full bg-canvas overflow-hidden">
              <div className="h-full bg-brand transition-all animate-pulse" style={{ width: '60%' }} />
            </div>
          )}
        </section>

        <section className="bg-content rounded-xl border border-border-soft p-5">
          <h2 className="font-semibold mb-2">备份指引</h2>
          <ul className="text-sm text-fg-secondary space-y-2 list-disc pl-5">
            <li>所有笔记均为本地 Markdown 文件，可直接复制整个知识库文件夹备份。</li>
            <li>推荐使用 Git + 远程仓库（如 GitHub 私有仓）做版本管理。</li>
            <li>配合 iCloud / OneDrive / Dropbox 等同步盘可实现多设备同步。</li>
            <li>AI 配置存储于本机 <code>~/.forgenote/</code>，不会随笔记同步。</li>
          </ul>
        </section>

        <section className="bg-content rounded-xl border border-border-soft p-5">
          <h2 className="font-semibold mb-2">关于与更新</h2>
          <p className="text-sm text-fg-secondary">锦囊笔记 ForgeNote</p>
          <p className="text-xs text-fg-muted mt-1">
            当前版本：<span className="font-mono">{version || '—'}</span> · MIT License · Forge your knowledge.
          </p>

          <div className="mt-4 pt-4 border-t border-border-soft">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-fg-secondary">{updateStatusText(update)}</div>
                {update?.type === 'progress' && (
                  <div className="mt-2 h-1.5 w-48 rounded-full bg-canvas overflow-hidden">
                    <div
                      className="h-full bg-brand transition-all"
                      style={{ width: `${Math.round(update.percent)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleCheck}
                  disabled={update?.type === 'checking' || downloading}
                  className="btn"
                >
                  {update?.type === 'checking' ? '检查中…' : '检查更新'}
                </button>
                {(update?.type === 'available' || update?.type === 'downloaded') && (
                  <button onClick={handleInstall} disabled={downloading} className="btn btn-primary">
                    {update?.type === 'downloaded' ? '重启并安装' : '下载更新'}
                  </button>
                )}
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-fg-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCheck}
                onChange={(e) => handleToggleAuto(e.target.checked)}
                className="accent-brand"
              />
              启动时自动检查更新
            </label>
            {update?.type === 'available' && update.releaseNotes && (
              <button
                type="button"
                onClick={() => setShowReleaseNotes(true)}
                className="mt-3 inline-flex items-center gap-1 text-xs text-brand hover:underline cursor-pointer"
              >
                <span>查看更新说明</span>
                <span aria-hidden>▼</span>
              </button>
            )}
          </div>
        </section>

        </>
        )}

        {tab === 'advanced' && (
          <section className="bg-content rounded-xl border border-border-soft p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">AI 用量（成本可观测）</h2>
              <button
                onClick={() => {
                  try {
                    window.forge.ai.resetUsage().then(loadUsage).catch(() => {});
                  } catch {
                    /* noop */
                  }
                }}
                className="btn text-xs"
              >
                清空统计
              </button>
            </div>
            {Object.keys(usage).length === 0 ? (
              <p className="text-xs text-fg-muted">暂无调用记录。每次 AI 调用都会累计 token 消耗与耗时，避免无感烧钱。</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border-soft">
                <table className="w-full text-xs">
                  <thead className="bg-hover-bg text-fg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">技能</th>
                      <th className="text-right px-3 py-2 font-medium">次数</th>
                      <th className="text-right px-3 py-2 font-medium">Tokens</th>
                      <th className="text-right px-3 py-2 font-medium">耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(usage).map(([skill, u]) => (
                      <tr key={skill} className="border-t border-border-soft">
                        <td className="px-3 py-2 text-fg">{skill}</td>
                        <td className="px-3 py-2 text-right text-fg-muted">{u.calls}</td>
                        <td className="px-3 py-2 text-right text-fg-muted">{u.tokens.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-fg-muted">
                          {(u.ms / 1000).toFixed(1)}s
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'advanced' && (
          <section className="bg-content rounded-xl border border-border-soft p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">外部 MCP 服务（能力扩展）</h2>
              <button
                onClick={() => {
                  const next = [
                    ...(cfg.mcpServers || []),
                    { name: '新服务', transport: 'stdio' as const, command: '', args: [] as string[], env: {} as Record<string, string>, url: '', enabled: true }
                  ];
                  setCfg({ ...cfg, mcpServers: next });
                }}
                className="btn btn-primary text-xs"
              >
                + 新增服务
              </button>
            </div>
            <p className="text-xs text-fg-muted mb-4">
              配置外部 MCP Server 后，AI 智能体可调用其提供的工具，无需改动核心代码（方案 §六）。
              保存后将在下次调用时自动连接。
            </p>

            <div className="space-y-3">
              {(cfg.mcpServers || []).length === 0 && (
                <p className="text-xs text-fg-faint">尚未配置任何外部 MCP 服务。</p>
              )}
              {(cfg.mcpServers || []).map((s, i) => (
                <div key={i} className="rounded-xl border border-border-soft p-4 space-y-3">
                  {s.description && (
                    <div className="flex items-start gap-2">
                      <p className="text-xs text-fg-muted leading-relaxed flex-1">{s.description}</p>
                      {s.name === 'duckduckgo' && (
                        <span className="badge badge-brand shrink-0">预置</span>
                      )}
                      {s.name === 'open-websearch' && (
                        <span className="badge badge-brand shrink-0">预置</span>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem_5rem_auto] gap-2 items-center">
                    <input
                      value={s.name}
                      onChange={(e) => {
                        const next = [...(cfg.mcpServers || [])];
                        next[i] = { ...next[i], name: e.target.value };
                        setCfg({ ...cfg, mcpServers: next });
                      }}
                      className="input"
                      placeholder="服务名"
                    />
                    <select
                      value={s.transport}
                      onChange={(e) => {
                        const next = [...(cfg.mcpServers || [])];
                        next[i] = { ...next[i], transport: e.target.value as 'stdio' | 'sse' };
                        setCfg({ ...cfg, mcpServers: next });
                      }}
                      className="input"
                    >
                      <option value="stdio">stdio</option>
                      <option value="sse">sse</option>
                    </select>
                    <label className="flex items-center justify-center gap-1.5 text-xs text-fg-muted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={s.enabled !== false}
                        onChange={(e) => {
                          const next = [...(cfg.mcpServers || [])];
                          next[i] = { ...next[i], enabled: e.target.checked };
                          const updated = { ...cfg, mcpServers: next };
                          setCfg(updated);
                          // MCP 启用状态即时持久化，避免用户忘记点顶部保存按钮导致丢失
                          void saveConfigSilently(updated);
                        }}
                        className="w-4 h-4 accent-brand cursor-pointer"
                      />
                      启用
                    </label>
                    <button
                      onClick={() => {
                        const next = (cfg.mcpServers || []).filter((_, j) => j !== i);
                        setCfg({ ...cfg, mcpServers: next });
                      }}
                      className="btn text-xs text-red-500 whitespace-nowrap"
                    >
                      删除
                    </button>
                  </div>
                  {s.transport === 'stdio' ? (
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        value={s.command || ''}
                        onChange={(e) => {
                          const next = [...(cfg.mcpServers || [])];
                          next[i] = { ...next[i], command: e.target.value };
                          const updated = { ...cfg, mcpServers: next };
                          setCfg(updated);
                          void saveConfigSilently(updated);
                        }}
                        className="input"
                        placeholder="命令，如 npx -y @modelcontextprotocol/server-filesystem"
                      />
                      <input
                        value={(s.args || []).join(' ')}
                        onChange={(e) => {
                          const next = [...(cfg.mcpServers || [])];
                          next[i] = { ...next[i], args: e.target.value.split(/\s+/).filter(Boolean) };
                          const updated = { ...cfg, mcpServers: next };
                          setCfg(updated);
                          void saveConfigSilently(updated);
                        }}
                        className="input"
                        placeholder="参数（空格分隔，可选）"
                      />
                    </div>
                  ) : (
                    <input
                      value={s.url || ''}
                      onChange={(e) => {
                        const next = [...(cfg.mcpServers || [])];
                        next[i] = { ...next[i], url: e.target.value };
                        const updated = { ...cfg, mcpServers: next };
                        setCfg(updated);
                        void saveConfigSilently(updated);
                      }}
                      className="input"
                      placeholder="SSE 地址，如 http://localhost:3000/sse"
                    />
                  )}
                  <div>
                    <label className="block text-xs text-fg-faint mb-1">环境变量（可选，KEY=VALUE 每行一条）</label>
                    <textarea
                      value={Object.entries(s.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                      onChange={(e) => {
                        const env: Record<string, string> = {};
                        e.target.value.split('\n').forEach((line) => {
                          const idx = line.indexOf('=');
                          if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
                        });
                        const next = [...(cfg.mcpServers || [])];
                        next[i] = { ...next[i], env };
                        const updated = { ...cfg, mcpServers: next };
                        setCfg(updated);
                        // 环境变量修改即时持久化
                        void saveConfigSilently(updated);
                      }}
                      className="input min-h-[3.5rem] resize-y font-mono text-xs"
                      rows={4}
                      placeholder={"DDG_MAX_RESULTS=5\nDDG_OUTPUT_FORMAT=dense\nDDG_REGION=wt-wt\nDDG_SAFE_SEARCH=MODERATE"}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'advanced' && (
          <section className="bg-content rounded-xl border border-border-soft p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold">提示词配置</h2>
              <button onClick={resetPrompts} className="btn text-xs">恢复默认</button>
            </div>
            <p className="text-xs text-fg-muted mb-4">
              以下为内置 AI 功能的固定提示词，可自定义后保存（持久化到本地，重新打开依然有效）。
            </p>

            <div className="space-y-5 text-sm">
              {/* 每天灵感一现（多 Agent 覆写：daily-muse Agent 的 systemPrompt） */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-fg-muted">每天灵感一现 · 灵光一现 Agent 人设（多 Agent 覆写）</label>
                  <button
                    onClick={async () => {
                      setAgentOverrideSaving(true);
                      try {
                        await window.forge.ai.setAgentOverrides({ 'daily-muse': { systemPrompt: agentOverride } });
                        pushToast({ level: 'success', text: '灵光一现 Agent 人设已保存' });
                      } catch (e) {
                        pushToast({ level: 'error', text: String(e) });
                      } finally {
                        setAgentOverrideSaving(false);
                      }
                    }}
                    disabled={agentOverrideSaving}
                    className="btn text-xs"
                  >
                    {agentOverrideSaving ? '保存中…' : '保存 Agent 人设'}
                  </button>
                </div>
                <textarea
                  value={agentOverride}
                  onChange={(e) => setAgentOverride(e.target.value)}
                  rows={6}
                  placeholder="留空则使用内置默认人设（禁鸡汤母题 / 跨域联想 / 历史去重）"
                  className="input mt-1.5 w-full resize-y"
                />
                <p className="text-[11px] text-fg-faint mt-1">
                  该配置覆盖内置「灵光一现（daily-muse）」Agent 的 systemPrompt，优先级：用户覆写 &gt; 内置默认。
                </p>
              </div>

              {/* 灵感方向 */}
              <div>
                <label className="text-xs text-fg-muted">灵感方向（灵感工坊，每组一条提示词）</label>
                <div className="mt-1.5 space-y-3">
                  {prompts.inspirationModes.map((m, i) => (
                    <div key={m.key} className="rounded-xl border border-border-soft p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={m.title}
                          onChange={(e) => patchMode(i, { title: e.target.value })}
                          className="input flex-1"
                          placeholder="方向标题"
                        />
                        <input
                          value={m.desc}
                          onChange={(e) => patchMode(i, { desc: e.target.value })}
                          className="input flex-1"
                          placeholder="一句话描述"
                        />
                      </div>
                      <textarea
                        value={m.prompt}
                        onChange={(e) => patchMode(i, { prompt: e.target.value })}
                        rows={3}
                        className="input w-full resize-y"
                        placeholder="该方向对应的 AI 提示词"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 对话快捷提问 */}
              <div>
                <label className="text-xs text-fg-muted">对话快捷提问（每行一条）</label>
                <textarea
                  value={prompts.chatQuickPrompts.join('\n')}
                  onChange={(e) =>
                    patchPrompt({ chatQuickPrompts: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
                  }
                  rows={4}
                  className="input mt-1.5 w-full resize-y"
                  placeholder="每行一条快捷提问"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button onClick={savePrompts} disabled={promptsSaving} className="btn btn-primary">
                  {promptsSaving ? '保存中…' : '保存提示词'}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* 更新说明弹窗 - 富文本渲染 GitHub Release Notes（受信任源） */}
      {showReleaseNotes && update?.releaseNotes && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="更新说明"
          onClick={() => setShowReleaseNotes(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[80vh] bg-content rounded-xl border border-border-soft shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft">
              <div className="text-sm font-medium">
                v{update.version || version} 更新说明
              </div>
              <button
                type="button"
                onClick={() => setShowReleaseNotes(false)}
                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-fg-muted hover:bg-canvas hover:text-fg text-lg leading-none"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div
              className="flex-1 overflow-auto px-6 py-4 text-sm leading-relaxed text-fg release-notes-body"
              dangerouslySetInnerHTML={{ __html: update.releaseNotes }}
            />
            <div className="px-5 py-3 border-t border-border-soft flex justify-end">
              <button
                type="button"
                onClick={() => setShowReleaseNotes(false)}
                className="btn btn-primary"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
