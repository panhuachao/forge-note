// 插件管理面板（doc/插件技术实现方案.md §12 阶段四）
//
// 在设置页「基础设置」底部展示：插件列表、启用/禁用、卸载、查看权限。
// 首次启用未授权插件会弹出权限确认（高权限标红二次确认）。
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useKBStore } from '../stores/kb-store';
import { PERMISSION_LABEL, HIGH_RISK_PERMISSIONS, type PluginInfo, type PluginPermission } from '@shared/types/plugin';
import { PluginPermissionDialog } from './PluginPermissionDialog';

export function PluginSettingPanel() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pending, setPending] = useState<PluginInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pushToast = useKBStore((s) => s.pushToast);
  const activeKb = useKBStore((s) => s.activeKb);

  const refresh = () => {
    window.forge.plugin
      .list()
      .then(setPlugins)
      .catch((e) => setErr(String(e)));
  };

  useEffect(refresh, []);

  const run = async (id: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(id);
    setErr(null);
    try {
      const r = await fn();
      if (!r.ok) {
        if (r.message === 'PENDING_PERMISSION') {
          const info = plugins.find((p) => p.id === id) ?? null;
          setPending(info);
        } else {
          setErr(r.message);
        }
      } else {
        pushToast({ level: 'success', text: r.message });
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const grant = async (perms: PluginPermission[]) => {
    if (!pending) return;
    await window.forge.plugin.grant(pending.id, perms);
    const id = pending.id;
    setPending(null);
    await run(id, () => window.forge.plugin.enable(id));
  };

  return (
    <section className="bg-content rounded-xl border border-border-soft p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold">插件管理</h2>
        <button
          onClick={refresh}
          className="text-xs text-fg-muted hover:text-fg px-2 py-1 rounded hover:bg-hover-bg"
        >
          刷新
        </button>
      </div>
      <p className="text-xs text-fg-muted mb-4">
        插件以本机原生模块形式运行，拥有完整的本地文件访问能力。请只安装来自可信作者的插件。
      </p>

      {err && (
        <div className="mb-3 text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {err}
        </div>
      )}

      {plugins.length === 0 ? (
        <div className="text-sm text-fg-faint border border-dashed border-border-soft rounded-lg py-8 text-center">
          尚未安装任何插件。将插件文件夹放入应用数据目录的 <code>plugins/</code> 即可被识别。
        </div>
      ) : (
        <div className="space-y-2">
          {plugins.map((p) => (
            <div
              key={p.id}
              className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                p.state === 'error'
                  ? 'border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/20'
                  : 'border-border-soft bg-canvas'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-fg truncate">{p.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-canvas text-fg-faint border border-border-soft shrink-0">
                    v{p.version}
                  </span>
                  {p.state === 'error' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 shrink-0">
                      运行出错
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">{p.description}</p>
                )}
                {p.author && <p className="text-[11px] text-fg-faint mt-0.5">作者：{p.author}</p>}
                {p.state === 'error' && p.error && (
                  <p className="text-[11px] text-red-600 mt-1 break-all">{p.error}</p>
                )}
                {p.manifest.permissions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.manifest.permissions.map((perm) => (
                      <span
                        key={perm}
                        title={PERMISSION_LABEL[perm]}
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          HIGH_RISK_PERMISSIONS.includes(perm)
                            ? 'border-red-300 text-red-600 bg-red-50 dark:bg-red-950/30'
                            : 'border-border-soft text-fg-faint'
                        }`}
                      >
                        {PERMISSION_LABEL[perm]}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                {p.state === 'active' ? (
                  <button
                    disabled={busy === p.id}
                    onClick={() => run(p.id, () => window.forge.plugin.disable(p.id))}
                    className="text-xs px-3 py-1.5 rounded-lg bg-hover-bg text-fg-secondary hover:bg-active-bg whitespace-nowrap"
                  >
                    {busy === p.id ? '处理中…' : '禁用'}
                  </button>
                ) : (
                  <button
                    disabled={busy === p.id}
                    onClick={() => run(p.id, () => window.forge.plugin.enable(p.id))}
                    className="text-xs px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover whitespace-nowrap"
                  >
                    {busy === p.id ? '处理中…' : p.state === 'error' ? '重试启用' : '启用'}
                  </button>
                )}
                <button
                  disabled={busy === p.id}
                  onClick={() => {
                    if (confirm(`确定卸载插件「${p.name}」？该操作会删除其文件与本地数据。`)) {
                      void run(p.id, () => window.forge.plugin.uninstall(p.id));
                    }
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap"
                >
                  卸载
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <PluginPermissionDialog
          plugin={pending}
          onCancel={() => setPending(null)}
          onConfirm={grant}
        />
      )}

      <p className="text-[11px] text-fg-faint mt-3">
        提示：知识库级启用——插件在当前激活的知识库启用后才会加载运行
        {activeKb ? `（当前：${activeKb.name}）` : '（未选择知识库）'}。
      </p>
    </section>
  );
}
