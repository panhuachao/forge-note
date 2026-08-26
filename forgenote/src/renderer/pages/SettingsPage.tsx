import { useEffect, useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import type { ThemeColorKey } from '../stores/layout-store';
import type { AIModelConfig, AIPrompts, InspirationModePrompt, AIServiceProvider } from '@shared/types';
import { DEFAULT_AI_PROMPTS, AI_SERVICE_DEFAULTS, AI_SERVICE_MODELS } from '@shared/types/ai';
import type { UpdateStatus } from '@shared/ipc-channels';
import { PageHeader } from '../components/PageHeader';

type SettingsTab = 'basic' | 'advanced';

export function SettingsPage() {
  const { aiConfig, setAIConfig, pushToast, activeKb } = useKBStore();
  const { fontSize, lineHeight, themeColor, setFontSize, setLineHeight, setThemeColor } = useLayoutStore();
  const [cfg, setCfg] = useState<AIModelConfig>(aiConfig);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('basic');
  const [prompts, setPrompts] = useState<AIPrompts>(DEFAULT_AI_PROMPTS);
  const [promptsSaving, setPromptsSaving] = useState(false);

  // 应用更新状态
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [autoCheck, setAutoCheck] = useState(true);
  const [downloading, setDownloading] = useState(false);

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

  function handleCheck() {
    const app = window.forge.app;
    if (!app) return;
    setUpdate({ type: 'checking' });
    app.checkUpdate().catch((e) => setUpdate({ type: 'error', message: String(e) }));
  }

  function handleInstall() {
    const app = window.forge.app;
    if (!app) return;
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

  // 加载高级设置中的固定提示词
  useEffect(() => {
    window.forge.ai.getPrompts().then(setPrompts).catch(() => {});
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
              <details className="mt-3 text-xs text-fg-muted">
                <summary className="cursor-pointer">查看更新说明</summary>
                <pre className="mt-2 whitespace-pre-wrap bg-canvas rounded p-2 max-h-48 overflow-auto">
                  {update.releaseNotes}
                </pre>
              </details>
            )}
          </div>
        </section>
        </>
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
              {/* 每天灵感一现 */}
              <div>
                <label className="text-xs text-fg-muted">每天灵感一现（灵感工坊）</label>
                <textarea
                  value={prompts.dailyInsight}
                  onChange={(e) => patchPrompt({ dailyInsight: e.target.value })}
                  rows={4}
                  className="input mt-1.5 w-full resize-y"
                />
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
    </div>
  );
}
