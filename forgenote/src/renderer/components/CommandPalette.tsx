// 命令面板（doc/插件技术实现方案.md §7.3）
//
// 插件系统的**首选扩展点**：一个 title + handler 即可让插件能力被用户触达，
// 不需要插件理解 React 或页面布局。
// 内置命令（切换页面）与插件命令统一在此搜索执行。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useLayoutStore } from '../stores/layout-store';
import { useKBStore } from '../stores/kb-store';

interface PaletteItem {
  key: string;
  title: string;
  group: string;
  hotkey?: string;
  run: () => void | Promise<void>;
}

interface Props {
  kbId?: string;
  notePath?: string;
}

export function CommandPalette({ kbId, notePath }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [commands, setCommands] = useState<{ key: string; pluginId: string; title: string; hotkey?: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const setMainView = useLayoutStore((s) => s.setMainView);
  const pushToast = useKBStore((s) => s.pushToast);

  // 全局快捷键：Cmd/Ctrl + P
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 打开时加载插件命令
  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    window.forge.plugin
      .commands()
      .then(setCommands)
      .catch(() => setCommands([]));
    // 聚焦输入框
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // 内置命令
  const builtins = useMemo<PaletteItem[]>(
    () => [
      { key: 'b:note', title: '前往：笔记', group: '导航', run: () => setMainView('note') },
      { key: 'b:home', title: '前往：首页', group: '导航', run: () => setMainView('home') },
      { key: 'b:chat', title: '前往：AI 对话', group: '导航', run: () => setMainView('chat') },
      { key: 'b:graph', title: '前往：知识图谱', group: '导航', run: () => setMainView('graph') },
      { key: 'b:inspiration', title: '前往：灵感工坊', group: '导航', run: () => setMainView('inspiration') },
      { key: 'b:diagnose', title: '前往：知识库诊断', group: '导航', run: () => setMainView('diagnose') },
      { key: 'b:template', title: '前往：模板', group: '导航', run: () => setMainView('template') },
      { key: 'b:audit', title: '前往：审计', group: '导航', run: () => setMainView('audit') },
      { key: 'b:settings', title: '前往：设置', group: '导航', run: () => setMainView('settings') }
    ],
    [setMainView]
  );

  // 插件命令
  const pluginItems = useMemo<PaletteItem[]>(
    () =>
      commands.map((c) => ({
        key: c.key,
        title: c.title,
        group: '插件',
        hotkey: c.hotkey,
        run: async () => {
          const r = await window.forge.plugin.runCommand(c.key, { kbId, notePath });
          if (!r.ok) pushToast({ level: 'error', text: r.message });
        }
      })),
    [commands, kbId, notePath, pushToast]
  );

  const results = useMemo(() => {
    const all = [...pluginItems, ...builtins];
    const kw = q.trim().toLowerCase();
    if (!kw) return all;
    return all.filter((i) => i.title.toLowerCase().includes(kw) || i.group.toLowerCase().includes(kw));
  }, [q, pluginItems, builtins]);

  const runAt = async (i: number) => {
    const item = results[i];
    if (!item) return;
    setOpen(false);
    try {
      await item.run();
    } catch (e) {
      pushToast({ level: 'error', text: String(e) });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center z-[60] pt-[14vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-content rounded-xl shadow-2xl border border-border-soft overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-soft">
          <Icon name="search" className="w-4 h-4 text-fg-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                void runAt(active);
              }
            }}
            placeholder="搜索命令…"
            className="flex-1 bg-transparent outline-none text-sm text-fg placeholder:text-fg-faint"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-canvas text-fg-faint border border-border-soft">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-fg-faint">没有匹配的命令</div>
          ) : (
            results.map((item, i) => (
              <button
                key={item.key}
                onMouseEnter={() => setActive(i)}
                onClick={() => void runAt(i)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                  i === active ? 'bg-brand-soft/50' : 'hover:bg-hover-bg'
                }`}
              >
                <Icon
                  name={item.group === '插件' ? 'sparkles' : 'chevron-right'}
                  className="w-3.5 h-3.5 text-fg-faint shrink-0"
                />
                <span className="flex-1 truncate text-fg">{item.title}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-canvas text-fg-faint shrink-0">
                  {item.group}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
