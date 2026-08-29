// 版本历史弹窗（doc/笔记版本实现方案.md §8.2）
//
// 左栏：版本列表（时间 / 来源徽章 / 变更行数）
// 右栏：与「当前」或「另一版本」的 diff，按行着色；可一键恢复。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import type { DiffLine, VersionListItem, VersionSource } from '@shared/types/version';

interface Props {
  kbId: string;
  notePath: string;
  onClose: () => void;
  onRestored?: () => void;
  pushToast: (t: { level: 'info' | 'success' | 'warn' | 'error'; text: string }) => void;
}

const SOURCE_META: Record<VersionSource, { label: string; cls: string }> = {
  auto: { label: '自动', cls: 'bg-canvas text-fg-muted' },
  manual: { label: '手动', cls: 'bg-brand-soft/60 text-brand' },
  ai: { label: 'AI', cls: 'bg-brand-soft/60 text-brand' },
  'pre-restore': { label: '恢复前', cls: 'bg-amber-500/15 text-amber-600' },
  'pre-move': { label: '移动前', cls: 'bg-amber-500/15 text-amber-600' }
};

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function VersionHistoryModal({ kbId, notePath, onClose, onRestored, pushToast }: Props) {
  const [versions, setVersions] = useState<VersionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  /** 比对基准：'current' 或某个版本 id */
  const [compareTo, setCompareTo] = useState<string>('current');
  const [diff, setDiff] = useState<DiffLine[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** 手动保存版本的备注输入 */
  const [noteInput, setNoteInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.forge.version.list(kbId, notePath);
      setVersions(list);
      setSelected((prev) => prev ?? list[0]?.id ?? null);
    } catch {
      pushToast({ level: 'error', text: '加载版本历史失败' });
    } finally {
      setLoading(false);
    }
  }, [kbId, notePath, pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  // 选中版本或比对基准变化时重新计算 diff
  useEffect(() => {
    if (!selected) {
      setDiff([]);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    void (async () => {
      try {
        const d = await window.forge.version.diff(kbId, notePath, compareTo, selected);
        if (!cancelled) setDiff(d);
      } catch {
        if (!cancelled) setDiff([]);
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kbId, notePath, selected, compareTo]);

  const selectedVersion = useMemo(() => versions.find((v) => v.id === selected) ?? null, [versions, selected]);

  const doRestore = async () => {
    if (!selectedVersion) return;
    setBusy(true);
    try {
      const r = await window.forge.version.restore(kbId, notePath, selectedVersion.id);
      pushToast({ level: r.ok ? 'success' : 'error', text: r.message });
      if (r.ok) {
        setConfirming(false);
        await load();
        onRestored?.();
      }
    } catch (e) {
      pushToast({ level: 'error', text: `恢复失败：${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async (v: VersionListItem) => {
    try {
      await window.forge.version.remove(kbId, notePath, v.id);
      await load();
      pushToast({ level: 'success', text: '已删除该版本' });
    } catch (e) {
      pushToast({ level: 'error', text: `删除失败：${String(e)}` });
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const id = await window.forge.version.create(kbId, notePath, noteInput.trim() || undefined);
      if (id) {
        pushToast({ level: 'success', text: '已保存当前版本' });
        setNoteInput('');
        await load();
        setSelected(id);
      } else {
        pushToast({ level: 'info', text: '内容与最新版本相同，未重复保存' });
      }
    } catch (e) {
      pushToast({ level: 'error', text: `保存失败：${String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const added = diff.filter((d) => d.type === 'add').length;
  const removed = diff.filter((d) => d.type === 'del').length;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-8" onClick={onClose}>
      <div
        className="bg-content rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-3 border-b border-border-soft flex items-center justify-between shrink-0">
          <h2 className="font-semibold flex items-center gap-1.5 text-sm">
            <Icon name="clock" className="w-4 h-4 text-brand" />
            版本历史
            <span className="text-fg-muted font-normal ml-1">{notePath.split('/').pop()?.replace(/\.md$/i, '')}</span>
          </h2>
          <button onClick={onClose} className="text-fg-faint hover:text-fg text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* 左：版本列表 */}
          <div className="w-64 shrink-0 border-r border-border-soft flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-xs text-fg-faint">加载中…</div>
              ) : versions.length === 0 ? (
                <div className="p-4 text-xs text-fg-faint leading-relaxed">
                  该笔记还没有历史版本。
                  <br />
                  开始编辑后会自动保存，也可以点击下方按钮手动保存。
                </div>
              ) : (
                <ul className="py-1">
                  <li className="px-3 py-1.5 text-[10px] text-fg-faint uppercase tracking-wider">当前</li>
                  <li
                    className={`px-3 py-1.5 text-xs cursor-pointer truncate ${
                      compareTo === 'current' ? 'bg-brand-soft/40' : 'hover:bg-hover-bg'
                    }`}
                    onClick={() => setCompareTo('current')}
                  >
                    现在的内容
                  </li>
                  <li className="px-3 py-1.5 text-[10px] text-fg-faint uppercase tracking-wider mt-2">
                    历史版本 ({versions.length})
                  </li>
                  {versions.map((v) => {
                    const meta = SOURCE_META[v.source] ?? SOURCE_META.auto;
                    const active = v.id === selected;
                    return (
                      <li
                        key={v.id}
                        className={`px-3 py-1.5 cursor-pointer ${active ? 'bg-brand-soft/40' : 'hover:bg-hover-bg'} ${
                          v.available ? '' : 'opacity-50'
                        }`}
                        onClick={() => setSelected(v.id)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${meta.cls}`}>{meta.label}</span>
                          <span className="text-xs text-fg truncate flex-1">{relTime(v.at)}</span>
                          {v.delta && (
                            <span className="text-[10px] text-fg-faint shrink-0 font-mono">
                              <span className="text-emerald-600">+{v.delta.added}</span>{' '}
                              <span className="text-red-500">-{v.delta.removed}</span>
                            </span>
                          )}
                        </div>
                        {v.note && <div className="text-[10px] text-fg-secondary truncate mt-0.5">「{v.note}」</div>}
                        <div className="text-[10px] text-fg-faint mt-0.5 flex items-center gap-1">
                          <span>{new Date(v.at).toLocaleString('zh-CN')}</span>
                          <span>· {bytes(v.size)}</span>
                          {!v.available && <span className="text-red-500">· 快照丢失</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 手动保存 */}
            <div className="border-t border-border-soft p-2 shrink-0">
              <div className="flex gap-1">
                <input
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="备注（可选）"
                  className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-border-soft bg-canvas text-fg placeholder:text-fg-faint outline-none focus:border-brand"
                />
                <button
                  onClick={doSave}
                  disabled={saving}
                  className="px-2 py-1 rounded text-xs bg-brand text-brand-fg hover:opacity-90 disabled:opacity-50 shrink-0"
                >
                  {saving ? '…' : '保存版本'}
                </button>
              </div>
            </div>
          </div>

          {/* 右：diff */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* 工具条 */}
            <div className="px-4 py-2 border-b border-border-soft flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-fg-muted">比对</span>
              <select
                value={compareTo}
                onChange={(e) => setCompareTo(e.target.value)}
                className="text-xs px-2 py-1 rounded border border-border-soft bg-canvas text-fg outline-none focus:border-brand max-w-[180px]"
              >
                <option value="current">当前内容</option>
                {versions
                  .filter((v) => v.id !== selected)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {relTime(v.at)}（{SOURCE_META[v.source]?.label ?? v.source}）
                    </option>
                  ))}
              </select>
              <span className="text-[11px] text-fg-faint">→ 选中版本</span>
              <div className="flex-1" />
              {diff.length > 0 && (
                <span className="text-[11px] font-mono">
                  <span className="text-emerald-600">+{added}</span> <span className="text-red-500">-{removed}</span>
                </span>
              )}
              <button
                onClick={() => setConfirming(true)}
                disabled={!selectedVersion || !selectedVersion.available || busy}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-brand text-brand-fg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="arrow-path" className="w-3 h-3" />
                恢复到此版本
              </button>
            </div>

            {/* 恢复确认条 */}
            {confirming && (
              <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center gap-2 shrink-0">
                <Icon name="x-circle" className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-[11px] text-fg-secondary flex-1">
                  恢复会把笔记内容替换为该版本。当前内容会先存为一个版本，可再次撤销。
                </span>
                <button
                  onClick={doRestore}
                  disabled={busy}
                  className="px-2.5 py-1 rounded text-xs bg-amber-500 text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? '恢复中…' : '确认恢复'}
                </button>
                <button onClick={() => setConfirming(false)} className="text-[11px] text-fg-faint hover:text-fg">
                  取消
                </button>
              </div>
            )}

            {/* diff 内容 */}
            <div className="flex-1 overflow-auto">
              {!selectedVersion ? (
                <div className="p-6 text-center text-xs text-fg-faint">请选择左侧一个版本查看差异</div>
              ) : diffLoading ? (
                <div className="p-6 text-center text-xs text-fg-faint">计算差异中…</div>
              ) : diff.length === 0 ? (
                <div className="p-6 text-center text-xs text-fg-faint">内容无差异</div>
              ) : (
                <div className="font-mono text-[11px] leading-relaxed py-1">
                  {diff.map((d, i) => {
                    if (d.type === 'gap') {
                      return (
                        <div key={i} className="px-3 py-0.5 text-center text-fg-faint bg-canvas/60 select-none">
                          {d.text}
                        </div>
                      );
                    }
                    const bg =
                      d.type === 'add'
                        ? 'bg-emerald-500/10'
                        : d.type === 'del'
                          ? 'bg-red-500/10'
                          : '';
                    const fg =
                      d.type === 'add'
                        ? 'text-emerald-700'
                        : d.type === 'del'
                          ? 'text-red-600'
                          : 'text-fg-secondary';
                    return (
                      <div key={i} className={`flex ${bg}`}>
                        <span className="w-10 shrink-0 text-right pr-2 text-fg-faint select-none">
                          {d.oldLineNo ?? ''}
                        </span>
                        <span className="w-10 shrink-0 text-right pr-2 text-fg-faint select-none">
                          {d.newLineNo ?? ''}
                        </span>
                        <span className={`w-4 shrink-0 select-none ${fg}`}>
                          {d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' '}
                        </span>
                        <span className={`flex-1 whitespace-pre-wrap break-all pr-3 ${fg}`}>{d.text || ' '}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 底部：删除选中版本 */}
            {selectedVersion && (
              <div className="px-4 py-2 border-t border-border-soft flex items-center justify-between shrink-0">
                <span className="text-[10px] text-fg-faint font-mono truncate">{selectedVersion.hash.slice(0, 12)}</span>
                <button
                  onClick={() => doRemove(selectedVersion)}
                  className="text-[11px] text-fg-faint hover:text-red-500 transition-colors"
                >
                  删除该版本
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
