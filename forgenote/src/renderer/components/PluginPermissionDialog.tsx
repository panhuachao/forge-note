// 首次启用插件的权限确认弹窗（doc/插件技术实现方案.md §12 阶段四 4.2）
//
// 高权限（network / fs:write）以红色二次确认样式呈现，明确告知用户风险。
import { useState } from 'react';
import { Icon } from './Icon';
import { PERMISSION_LABEL, HIGH_RISK_PERMISSIONS, type PluginInfo, type PluginPermission } from '@shared/types/plugin';

interface Props {
  plugin: PluginInfo;
  onCancel: () => void;
  onConfirm: (perms: PluginPermission[]) => void;
}

export function PluginPermissionDialog({ plugin, onCancel, onConfirm }: Props) {
  // 默认勾选全部声明权限；用户可取消某项再授权
  const [selected, setSelected] = useState<Set<PluginPermission>>(
    new Set(plugin.manifest.permissions)
  );

  const toggle = (p: PluginPermission) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const hasHighRisk = plugin.manifest.permissions.some((p) => HIGH_RISK_PERMISSIONS.includes(p));

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-content rounded-2xl border border-border-soft shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-soft flex items-center gap-2">
          <Icon name="shield-check" className="w-5 h-5 text-brand" />
          <h3 className="font-semibold text-fg">启用插件 · 权限确认</h3>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="font-medium text-fg">{plugin.name}</div>
            {plugin.author && <div className="text-xs text-fg-faint">作者：{plugin.author}</div>}
          </div>

          <p className="text-xs text-fg-muted">
            该插件请求以下权限。插件以本机原生模块运行，<b className="text-fg">拥有完整的本地文件访问能力</b>，
            请确认你信任该插件后再授权。
          </p>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {plugin.manifest.permissions.map((perm) => {
              const high = HIGH_RISK_PERMISSIONS.includes(perm);
              const checked = selected.has(perm);
              return (
                <label
                  key={perm}
                  className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                    high
                      ? 'border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/20'
                      : 'border-border-soft hover:bg-hover-bg'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(perm)}
                    className="mt-0.5 accent-brand"
                  />
                  <div className="min-w-0">
                    <div className={`text-sm flex items-center gap-1.5 ${high ? 'text-red-600' : 'text-fg'}`}>
                      {PERMISSION_LABEL[perm]}
                      {high && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40">
                          高风险
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-faint break-all">{perm}</div>
                  </div>
                </label>
              );
            })}
          </div>

          {hasHighRisk && (
            <div className="text-[11px] text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded px-3 py-2">
              ⚠ 该插件包含高风险权限：授予后它可访问网络或修改/删除你的笔记。若来源不明，强烈建议取消勾选或放弃启用。
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border-soft flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded-lg bg-hover-bg text-fg-secondary hover:bg-active-bg"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm([...selected])}
            className={`text-sm px-4 py-2 rounded-lg text-brand-fg ${
              hasHighRisk ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-hover'
            }`}
          >
            确认授权并启用
          </button>
        </div>
      </div>
    </div>
  );
}
