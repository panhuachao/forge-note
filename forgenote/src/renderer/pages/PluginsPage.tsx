import { useState, useCallback, useEffect } from 'react';
import type { PluginInfo, PluginPermission } from '@shared/types/plugin';
import { loadAllPluginUI } from '../plugin/runtime';
import { PageHeader } from '../components/PageHeader';

// 社区插件仓库（公开仓位）：https://github.com/panhuachao/forge-note-plugins
// 插件页直接访问该仓库：拉取 community-plugins.json 索引，安装时从仓库下载插件文件。
const REPO_BASE = 'https://github.com/panhuachao/forge-note-plugins';
const RAW_BASE = 'https://raw.githubusercontent.com/panhuachao/forge-note-plugins/main';
const RAW_INDEX_URL = `${RAW_BASE}/community-plugins.json`;

interface CommunityPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  tags: string[];
  minAppVersion: string;
  apiVersion: number;
  permissions: PluginPermission[];
  repo: string;
  files: string[]; // 相对仓库根的文件路径
  official: boolean;
}

type PluginTab = 'installed' | 'community';

const RISK_PERMS: PluginPermission[] = ['fs:write', 'ai:skill', 'ai:tool', 'network'];

function PermissionBadge({ perm }: { perm: PluginPermission }) {
  const risk = RISK_PERMS.includes(perm);
  return (
    <span className={`perm ${risk ? 'perm-risk' : 'perm-ok'}`} title={risk ? '高风险权限' : ''}>
      {perm}
    </span>
  );
}

async function fetchCommunityIndex(): Promise<CommunityPlugin[]> {
  try {
    const res = await fetch(RAW_INDEX_URL);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.plugins)) return json.plugins as CommunityPlugin[];
    }
  } catch {
    /* 网络失败返回空 */
  }
  return [];
}

async function downloadPluginFiles(files: string[]): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  for (const f of files) {
    const res = await fetch(`${RAW_BASE}/${f}`);
    if (!res.ok) throw new Error(`下载失败：${f} (${res.status})`);
    out.push({ path: f, content: await res.text() });
  }
  return out;
}

/**
 * 通过 GitHub Contents API 递归列举某仓库目录下的所有文件（自适应默认分支）。
 */
async function listRepoDir(dir: string, acc: string[] = []): Promise<string[]> {
  const api = `https://api.github.com/repos/panhuachao/forge-note-plugins/contents/${encodeURIComponent(dir)}`;
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`contents API ${res.status} @ ${dir}`);
  const entries = await res.json();
  if (!Array.isArray(entries)) return acc;
  for (const e of entries as { type: string; path: string }[]) {
    if (e.type === 'file') acc.push(e.path);
    else if (e.type === 'dir') await listRepoDir(e.path, acc);
  }
  return acc;
}

/**
 * 解析某插件需要下载的文件列表：
 * 1) 优先使用索引中声明的 files 字段；
 * 2) 否则通过 GitHub Contents API 递归列举该插件目录下的文件（无需手动维护 files）。
 */
async function resolvePluginFiles(p: CommunityPlugin): Promise<string[]> {
  if (Array.isArray(p.files) && p.files.length > 0) return p.files;
  return listRepoDir(`plugins/${p.id}`);
}

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [community, setCommunity] = useState<CommunityPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexLoading, setIndexLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [permModal, setPermModal] = useState<{ id: string; name: string; perms: PluginPermission[] } | null>(null);
  const [sourceModal, setSourceModal] = useState(false);
  const [sourceDir, setSourceDir] = useState('');
  const [tab, setTab] = useState<PluginTab>('installed');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.forge.plugin.list();
      setPlugins(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCommunity = useCallback(async () => {
    setIndexLoading(true);
    try {
      const idx = await fetchCommunityIndex();
      setCommunity(idx);
    } finally {
      setIndexLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    loadCommunity();
  }, [refresh, loadCommunity]);

  const installedIds = new Set(plugins.map((p) => p.id));

  async function handleEnable(id: string) {
    await window.forge.plugin.enable(id);
    await loadAllPluginUI();
    refresh();
  }
  async function handleDisable(id: string) {
    await window.forge.plugin.disable(id);
    await loadAllPluginUI();
    refresh();
  }
  async function handleUninstall(id: string) {
    if (!confirm(`确定卸载插件「${id}」？将从磁盘删除其目录与本地数据。`)) return;
    await window.forge.plugin.uninstall(id);
    await loadAllPluginUI();
    refresh();
  }
  async function handleGrant(id: string, name: string, perms: PluginPermission[]) {
    const risky = perms.filter((p) => RISK_PERMS.includes(p));
    if (risky.length) {
      const ok = confirm(`插件「${name}」请求高风险权限：${risky.join('、')}。是否授权？`);
      if (!ok) return;
    }
    await window.forge.plugin.grant(id, perms);
    refresh();
  }
  async function handleRevoke(id: string) {
    await window.forge.plugin.revoke(id);
    refresh();
  }

  async function handleInstallSource() {
    if (!sourceDir.trim()) return;
    const res = await window.forge.plugin.installBuiltin(
      sourceDir.trim().split(/[\\/]/).pop() || sourceDir.trim(),
      sourceDir.trim()
    );
    if (res.ok) {
      setSourceModal(false);
      setSourceDir('');
      refresh();
    } else {
      alert(res.message);
    }
  }

  async function handleInstallCommunity(p: CommunityPlugin) {
    setInstallingId(p.id);
    try {
      const files = await resolvePluginFiles(p);
      if (!files.length) {
        alert(`未在仓库中找到插件「${p.id}」的文件。\n请确认：\n1) forge-note-plugins 仓库根目录下存在名为「${p.id}」的插件目录；\n2) 该目录包含 manifest.json 等插件文件。`);
        return;
      }
      const contents = await downloadPluginFiles(files);
      const res = await window.forge.plugin.installFiles(p.id, contents);
      if (res.ok) refresh();
      else alert(res.message);
    } catch (e) {
      alert(`安装失败：${String(e)}`);
    } finally {
      setInstallingId(null);
    }
  }

  function PluginCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas border border-border-soft rounded-xl p-4 flex flex-col gap-3 hover:border-brand/40 transition-colors">
      {children}
    </div>
  );
}

function StateBadge({ state }: { state: PluginInfo['state'] }) {
  switch (state) {
    case 'active':
      return <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 shrink-0">运行中</span>;
    case 'disabled':
      return <span className="text-xs px-1.5 py-0.5 rounded bg-hover-bg text-fg-secondary shrink-0">已禁用</span>;
    case 'error':
      return <span className="text-xs px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 shrink-0">出错</span>;
    case 'pending-permission':
      return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 shrink-0">待授权</span>;
    default:
      return <span className="text-xs px-1.5 py-0.5 rounded bg-hover-bg text-fg-secondary shrink-0">{state}</span>;
  }
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-content border border-border rounded-2xl shadow-xl p-5 w-full max-w-md flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <PageHeader icon="puzzle" title="插件管理" />

      <div className="flex-1 overflow-y-auto p-6 pt-20 space-y-6 bg-canvas">
        <div className="mx-auto max-w-5xl flex flex-col gap-5">
          {/* Tab 切换 */}
          <div className="flex items-center gap-2 w-fit">
            {(
              [
                { k: 'installed', label: '已安装插件' },
                { k: 'community', label: '社区插件' }
              ] as { k: PluginTab; label: string }[]
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

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-500/10 text-rose-600 px-4 py-3 text-sm">
              {error}
            </div>
          )}

        {tab === 'installed' && (
        <section className="bg-content rounded-xl border border-border-soft p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-fg">已安装插件（{plugins.length}）</h2>
            <button
              className="btn btn-secondary text-xs px-3 py-1.5 rounded-lg"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
          <p className="text-sm text-fg-secondary">
            插件以本机原生模块运行在应用主进程，按知识库维度启用。启用含权限的插件需授权；
            启动时按住 <kbd className="px-1 py-0.5 rounded bg-hover-bg border border-border-soft text-xs">Shift</kbd> 可进入安全模式跳过所有插件。
          </p>
          {plugins.length === 0 && !loading && (
            <p className="text-sm text-fg-secondary">暂无插件。可从下方「社区插件」一键安装，或用「从本地目录添加」。</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plugins.map((p) => (
              <PluginCard key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-fg truncate">{p.name}</span>
                      <span className="text-xs text-fg-secondary bg-hover-bg px-1.5 py-0.5 rounded">v{p.version}</span>
                    </div>
                    <p className="text-sm text-fg-secondary mt-0.5">{p.description}</p>
                  </div>
                  <StateBadge state={p.state} />
                </div>

                {p.manifest.permissions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.manifest.permissions.map((perm) => <PermissionBadge key={perm} perm={perm} />)}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-auto">
                  {p.state === 'active' ? (
                    <button
                      className="btn btn-secondary text-xs px-2.5 py-1 rounded-lg"
                      onClick={() => handleDisable(p.id)}
                    >禁用</button>
                  ) : p.state === 'disabled' ? (
                    <button
                      className="btn btn-primary text-xs px-2.5 py-1 rounded-lg"
                      onClick={() => handleEnable(p.id)}
                    >启用</button>
                  ) : p.state === 'error' ? (
                    <span className="text-xs text-rose-500">运行出错：{p.error}</span>
                  ) : p.state === 'pending-permission' ? (
                    <span className="text-xs text-amber-500">待授权</span>
                  ) : null}

                  {p.manifest.permissions.length > 0 && (
                    p.grantedPermissions.length >= p.manifest.permissions.length ? (
                      <button
                        className="btn btn-secondary text-xs px-2.5 py-1 rounded-lg"
                        onClick={() => handleRevoke(p.id)}
                      >撤销授权</button>
                    ) : (
                      <button
                        className="btn btn-secondary text-xs px-2.5 py-1 rounded-lg"
                        onClick={() => setPermModal({ id: p.id, name: p.name, perms: p.manifest.permissions })}
                      >授权</button>
                    )
                  )}

                  <button
                    className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all bg-rose-500 text-white hover:bg-rose-600"
                    onClick={() => handleUninstall(p.id)}
                  >卸载</button>
                </div>
              </PluginCard>
            ))}
          </div>
        </section>
        )}

        {tab === 'community' && (
        <section className="bg-content rounded-xl border border-border-soft p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-fg">社区插件</h2>
            <button
              className="btn btn-secondary text-xs px-3 py-1.5 rounded-lg"
              onClick={() => setSourceModal(true)}
            >
              从本地目录添加
            </button>
          </div>
          <p className="text-sm text-fg-secondary">
            直接从公开仓库 <code className="text-xs bg-hover-bg px-1 py-0.5 rounded">{REPO_BASE}</code> 获取索引与文件并安装。
          </p>
          {indexLoading && <p className="text-sm text-fg-secondary">正在从仓库拉取索引…</p>}
          {!indexLoading && community.length === 0 && (
            <p className="text-sm text-fg-secondary">未能加载社区索引，请检查网络连接或稍后重试。</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {community.map((c) => {
              const installed = installedIds.has(c.id);
              return (
                <PluginCard key={c.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-fg truncate">{c.name}</span>
                        <span className="text-xs text-fg-secondary bg-hover-bg px-1.5 py-0.5 rounded">v{c.version}</span>
                        {c.official && <span className="badge badge-official">官方</span>}
                      </div>
                      <p className="text-sm text-fg-secondary mt-0.5">{c.description}</p>
                      <p className="text-xs text-fg-muted mt-1">作者：{c.author} · {c.tags.join(' / ')}</p>
                    </div>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-hover-bg text-fg-secondary shrink-0">
                      {installed ? '已安装' : '未安装'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {c.permissions.map((perm) => <PermissionBadge key={perm} perm={perm} />)}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-auto">
                    {installed ? (
                      <button
                        className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all bg-rose-500 text-white hover:bg-rose-600"
                        onClick={() => handleUninstall(c.id)}
                      >卸载</button>
                    ) : (
                      <button
                        className="btn btn-primary text-xs px-2.5 py-1 rounded-lg"
                        disabled={installingId === c.id}
                        onClick={() => handleInstallCommunity(c)}
                      >
                        {installingId === c.id ? '安装中…' : '安装'}
                      </button>
                    )}
                    <a
                      className="btn btn-secondary text-xs px-2.5 py-1 rounded-lg inline-flex items-center"
                      href={c.repo}
                      target="_blank"
                      rel="noreferrer"
                    >仓库</a>
                  </div>
                </PluginCard>
              );
            })}
          </div>
        </section>
        )}
      </div>

      {permModal && (
        <Modal onClose={() => setPermModal(null)}>
          <h3 className="text-base font-semibold text-fg">授权插件「{permModal.name}」</h3>
          <p className="text-sm text-fg-secondary">以下权限将被授予该插件：</p>
          <div className="flex flex-wrap gap-1.5">
            {permModal.perms.map((perm) => <PermissionBadge key={perm} perm={perm} />)}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-secondary text-sm px-3 py-1.5 rounded-lg" onClick={() => setPermModal(null)}>取消</button>
            <button
              className="btn btn-primary text-sm px-3 py-1.5 rounded-lg"
              onClick={() => {
                handleGrant(permModal.id, permModal.name, permModal.perms);
                setPermModal(null);
              }}
            >授予权限</button>
          </div>
        </Modal>
      )}

      {sourceModal && (
        <Modal onClose={() => setSourceModal(false)}>
          <h3 className="text-base font-semibold text-fg">从本地目录添加插件</h3>
          <p className="text-sm text-fg-secondary">粘贴插件目录（含 manifest.json）的绝对路径：</p>
          <input
            className="input w-full"
            placeholder="/path/to/your-plugin"
            value={sourceDir}
            onChange={(e) => setSourceDir(e.target.value)}
          />
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn btn-secondary text-sm px-3 py-1.5 rounded-lg" onClick={() => setSourceModal(false)}>取消</button>
            <button className="btn btn-primary text-sm px-3 py-1.5 rounded-lg" onClick={handleInstallSource}>安装</button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}
