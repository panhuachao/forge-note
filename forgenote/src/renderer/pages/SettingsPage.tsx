import { useState } from 'react';
import { useKBStore } from '../stores/kb-store';
import type { AIModelConfig } from '@shared/types';
import { Icon } from '../components/Icon';

export function SettingsPage() {
  const { aiConfig, setAIConfig, pushToast, activeKb } = useKBStore();
  const [cfg, setCfg] = useState<AIModelConfig>(aiConfig);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <div className="h-10 flex items-center px-4 border-b border-border bg-content text-sm">
        <span className="font-medium flex items-center gap-1.5"><Icon name="cog" className="w-4 h-4 text-brand" /> 设置</span>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <section className="bg-content rounded border border-border p-5">
          <h2 className="font-semibold mb-1">AI 模型配置</h2>
          <p className="text-xs text-fg-muted mb-4">
            选择本地 Ollama 或远端 OpenAI 兼容服务。关闭后所有 AI 操作降级为本地规则引擎。
          </p>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-xs text-fg-muted">服务类型</label>
              <select
                value={cfg.provider}
                onChange={(e) => setCfg({ ...cfg, provider: e.target.value as AIModelConfig['provider'] })}
                className="input"
              >
                <option value="none">关闭（本地规则引擎降级）</option>
                <option value="ollama">Ollama（本地大模型，推荐）</option>
                <option value="openai">OpenAI 兼容（DeepSeek / OpenAI / Moonshot 等）</option>
              </select>
            </div>
            {cfg.provider === 'ollama' && (
              <>
                <div>
                  <label className="text-xs text-fg-muted">服务地址</label>
                  <input
                    value={cfg.baseUrl || 'http://127.0.0.1:11434'}
                    onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="text-xs text-fg-muted">模型名称（如 qwen2.5:7b, llama3.1）</label>
                  <input
                    value={cfg.model || ''}
                    onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                    className="input"
                    placeholder="qwen2.5:7b"
                  />
                </div>
              </>
            )}
            {cfg.provider === 'openai' && (
              <>
                <div>
                  <label className="text-xs text-fg-muted">Base URL</label>
                  <input
                    value={cfg.baseUrl || 'https://api.deepseek.com/v1'}
                    onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                    className="input"
                    placeholder="https://api.deepseek.com/v1"
                  />
                  <p className="text-xs text-fg-faint mt-1">DeepSeek 填 https://api.deepseek.com/v1；OpenAI 填 https://api.openai.com/v1；Moonshot 填 https://api.moonshot.cn/v1</p>
                </div>
                <div>
                  <label className="text-xs text-fg-muted">模型名称</label>
                  <input
                    value={cfg.model || 'deepseek-chat'}
                    onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                    className="input"
                    placeholder="deepseek-chat"
                  />
                  <p className="text-xs text-fg-faint mt-1">DeepSeek 常用：deepseek-chat / deepseek-reasoner</p>
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
          <section className="bg-content rounded border border-border p-5">
            <h2 className="font-semibold mb-1">知识库</h2>
            <p className="text-xs text-fg-muted mb-2">当前：{activeKb.name}</p>
            <p className="text-xs text-fg-muted break-all">路径：{activeKb.rootPath}</p>
          </section>
        )}

        <section className="bg-content rounded border border-border p-5">
          <h2 className="font-semibold mb-2">备份指引</h2>
          <ul className="text-sm text-fg-secondary space-y-2 list-disc pl-5">
            <li>所有笔记均为本地 Markdown 文件，可直接复制整个知识库文件夹备份。</li>
            <li>推荐使用 Git + 远程仓库（如 GitHub 私有仓）做版本管理。</li>
            <li>配合 iCloud / OneDrive / Dropbox 等同步盘可实现多设备同步。</li>
            <li>AI 配置存储于本机 <code>~/.forgenote/</code>，不会随笔记同步。</li>
          </ul>
        </section>

        <section className="bg-content rounded border border-border p-5">
          <h2 className="font-semibold mb-2">关于</h2>
          <p className="text-sm text-fg-secondary">锦囊笔记 ForgeNote V1.1</p>
          <p className="text-xs text-fg-muted mt-1">MIT License · Forge your knowledge.</p>
        </section>
      </div>
    </div>
  );
}
