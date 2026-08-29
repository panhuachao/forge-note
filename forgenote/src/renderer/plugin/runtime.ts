// 渲染层插件运行时与 UI 插槽（doc/插件技术实现方案.md §7.4 / §3.1）
//
// 渲染层运行在隔离上下文（contextIsolation: true, nodeIntegration: false），
// 因此插件 UI 代码**不能** require 任何 Node 模块，只能通过 window.forge.* 与 DOM 交互。
//
// 插槽设计要点：不向插件暴露 React——插件拿到的是 DOM 容器，
// 用原生 DOM 或自带框架渲染。这样避免插件与宿主 React 版本强耦合，
// 是长期兼容性的关键取舍（Obsidian 暴露 React，代价是插件与宿主版本绑定）。

import type { Extension } from '@codemirror/state';

export type SlotKind = 'sidebar' | 'menu' | 'view' | 'settings' | 'statusbar' | 'editor';

export interface SlotItem {
  id: string;
  pluginId: string;
  title: string;
  icon?: string;
  render?: (container: HTMLElement) => void;
  onClick?: () => void;
}

type Listener = () => void;

// 稳定空数组：未注册某 kind 时返回同一引用，避免 useSyncExternalStore 因
// 每次 getSnapshot 返回新 [] 而陷入无限重渲染（Maximum update depth exceeded）。
const EMPTY: SlotItem[] = [];

class PluginSlotRegistry {
  private slots = new Map<SlotKind, SlotItem[]>();
  private listeners = new Map<SlotKind, Set<Listener>>();

  register(kind: SlotKind, item: SlotItem): void {
    const list = this.slots.get(kind) ?? EMPTY;
    // 不可变更新：生成新数组引用，使 useSyncExternalStore 能检测变化；
    // 同 id 重复注册视为更新（支持插件热重载）。
    const idx = list.findIndex((x) => x.id === item.id);
    const next = idx >= 0 ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
    this.slots.set(kind, next);
    this.notify(kind);
  }

  unregisterByOwner(pluginId: string): void {
    for (const [kind, list] of this.slots) {
      const next = list.filter((x) => x.pluginId !== pluginId);
      if (next.length !== list.length) {
        // 引用变更才替换，确保无意义变更不触发重渲染
        this.slots.set(kind, next);
        this.notify(kind);
      }
    }
  }

  list(kind: SlotKind): SlotItem[] {
    // 返回 Map 中缓存的同一数组引用；无则返回稳定 EMPTY
    return this.slots.get(kind) ?? EMPTY;
  }

  subscribe(kind: SlotKind, cb: Listener): () => void {
    const set = this.listeners.get(kind) ?? new Set();
    set.add(cb);
    this.listeners.set(kind, set);
    return () => set.delete(cb);
  }

  private notify(kind: SlotKind): void {
    for (const cb of this.listeners.get(kind) ?? []) cb();
  }
}

export const pluginSlots = new PluginSlotRegistry();

/* ==================== 编辑器扩展（CodeMirror） ==================== */

/**
 * 插件注册的 CodeMirror 扩展收集器。
 * 每个已启用插件可贡献 0..n 个 Extension（来自 'ui:editor' 权限）。
 * 为避免渲染层插件拿到 Node 能力，扩展对象由其 UI 模块在隔离上下文里
 * 通过 window.forge.cm 暴露的构造器生成——这里只做聚合，不接触构造细节。
 */
const editorExtensions: Extension[] = [];

export function addPluginEditorExtensions(exts: Extension[]): void {
  editorExtensions.push(...exts);
}

export function clearPluginEditorExtensions(): void {
  editorExtensions.length = 0;
}

/** NotePane 在创建 EditorState 时调用：返回已注册的全部编辑器扩展 */
export function getPluginEditorExtensions(): Extension[] {
  return editorExtensions;
}

/* ==================== 插件 UI API ==================== */

/** 构造某个插件在渲染层可用的 API 对象 */
export function buildUIPluginApi(pluginId: string): {
  pluginId: string;
  ui: {
    registerSidebarPanel: (def: { id: string; title: string; render: (c: HTMLElement) => void }) => void;
    registerMenuItem: (def: { id: string; label: string; icon?: string; onClick: () => void }) => void;
    registerView: (def: { id: string; title: string; render: (c: HTMLElement) => void }) => void;
    registerSettingTab: (def: { id: string; title: string; render: (c: HTMLElement) => void }) => void;
    registerStatusBar: (def: { id: string; render: (c: HTMLElement) => void }) => void;
    toast: (msg: { level: 'info' | 'success' | 'warn' | 'error'; text: string }) => void;
  };
} {
  const reg = (kind: SlotKind, item: Omit<SlotItem, 'pluginId'>) =>
    pluginSlots.register(kind, { ...item, pluginId });

  return {
    pluginId,
    ui: {
      registerSidebarPanel: (d) => reg('sidebar', { id: d.id, title: d.title, render: d.render }),
      registerMenuItem: (d) => reg('menu', { id: d.id, title: d.label, icon: d.icon, onClick: d.onClick }),
      registerView: (d) => reg('view', { id: d.id, title: d.title, render: d.render }),
      registerSettingTab: (d) => reg('settings', { id: d.id, title: d.title, render: d.render }),
      registerStatusBar: (d) => reg('statusbar', { id: d.id, title: '', render: d.render }),
      toast: (msg) => {
        // 转发到全局 toast（与宿主共用同一提示体系）
        window.dispatchEvent(
          new CustomEvent('forgenote:plugin-toast', {
            detail: { pluginId, ...msg }
          })
        );
      }
    }
  };
}

/* ==================== 插件 UI 代码加载 ==================== */

/**
 * 加载并执行插件的渲染层入口。
 *
 * 插件 UI 文件是通过 IPC 拿到的**绝对路径**，用 fetch + new Function 在隔离上下文中执行，
 * 而非 <script src>（后者要求文件在 web root 下）。
 * 插件内部通过 module.exports 导出 onload/onunload，这里用 CommonJS 垫片承接。
 */
export async function loadPluginUI(pluginId: string, uiFile: string): Promise<(() => void) | null> {
  try {
    const code = await window.forge.plugin.readUiFile(pluginId, uiFile);
    if (!code) return null;

    const moduleShim = { exports: {} as Record<string, unknown> };
    // eslint-disable-next-line no-new-func
    const fn = new Function('module', 'exports', 'require', code);
    // require 传一个恒抛错的桩：渲染层无 Node 能力，明确告知插件作者
    fn(
      moduleShim,
      moduleShim.exports,
      () => {
        throw new Error('渲染层插件不可使用 require（contextIsolation 已启用，请用 window.forge.* API）');
      }
    );

    const mod = moduleShim.exports as { onload?: (api: unknown) => void; onunload?: (api: unknown) => void };
    if (typeof mod.onload !== 'function') return null;

    const api = buildUIPluginApi(pluginId);
    mod.onload(api);

    return () => {
      try {
        pluginSlots.unregisterByOwner(pluginId);
        mod.onunload?.(api);
      } catch {
        /* 卸载出错不影响其它插件 */
      }
    };
  } catch (e) {
    console.error(`[plugin:${pluginId}] UI 加载失败`, e);
    return null;
  }
}

/** 启动时加载全部已启用插件的 UI，返回批量卸载函数 */
export async function loadAllPluginUI(): Promise<() => void> {
  let entries: { id: string; uiFile: string }[] = [];
  try {
    entries = await window.forge.plugin.uiEntries();
  } catch {
    return () => {};
  }
  const cleanups: (() => void)[] = [];
  for (const e of entries) {
    const off = await loadPluginUI(e.id, e.uiFile);
    if (off) cleanups.push(off);
  }
  return () => {
    for (const c of cleanups) c();
  };
}
