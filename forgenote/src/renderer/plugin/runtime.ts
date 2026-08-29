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
    registerCodeBlockRenderer: (def: {
      lang: string;
      render: (container: HTMLElement, code: string) => void | Promise<void>;
    }) => void;
    loadVendor: (relativePath: string) => Promise<void>;
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
      registerCodeBlockRenderer: (d) =>
        registerCodeBlockRenderer({ lang: d.lang, render: d.render, pluginId }),
      loadVendor: async (relativePath: string) => {
        // 读取插件自带 vendor 库内容，并在干净的隔离上下文中执行，使其暴露为全局变量（如 window.mermaid）。
        // 把 module/exports/define 遮蔽掉，防止 UMD 把库注册到当前插件的 CommonJS 垫片而不是全局。
        // 避免插件使用 <script src="file://..."> 被 Electron 安全策略拦截。
        const code = await window.forge.plugin.readResourceFile(pluginId, relativePath);
        if (!code) throw new Error(`无法加载插件资源：${relativePath}`);
        try {
          // eslint-disable-next-line no-new-func
          new Function(`(function(){var module=undefined,exports=undefined,define=undefined;\n${code}\n})();`)();
        } catch (e) {
          console.error(`[plugin] ${pluginId} 执行 vendor ${relativePath} 失败：`, e);
          throw e;
        }
      },
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

/* ==================== 预览代码块渲染扩展 ==================== */

/**
 * 插件声明的「预览代码块渲染器」。
 * lang 为代码块语言（如 'mermaid'）；宿主在预览渲染后，对
 * `<code class="language-<lang>">` 调用 render(container, codeText)。
 * 具体渲染能力（加载哪个库）完全由插件自带，宿主不绑定任何绘图库，
 * 以便后续扩展 plantuml / cytoscape 等时无需改动宿主。
 */
export interface CodeBlockRenderer {
  pluginId: string;
  lang: string;
  render: (container: HTMLElement, code: string) => void | Promise<void>;
}

const codeBlockRenderers: CodeBlockRenderer[] = [];
const codeBlockRendererListeners = new Set<() => void>();

function notifyCodeBlockRenderersChanged(): void {
  for (const cb of codeBlockRendererListeners) cb();
}

/** 订阅代码块渲染器注册表变化（如插件启用/卸载时）。返回取消订阅函数。 */
export function onCodeBlockRenderersChanged(cb: () => void): () => void {
  codeBlockRendererListeners.add(cb);
  return () => codeBlockRendererListeners.delete(cb);
}

export function registerCodeBlockRenderer(r: Omit<CodeBlockRenderer, 'pluginId'> & { pluginId?: string }): void {
  // 同 lang 重复注册视为覆盖（支持热重载）；先移除旧的
  const pid = r.pluginId;
  for (let i = codeBlockRenderers.length - 1; i >= 0; i--) {
    if (codeBlockRenderers[i].lang === r.lang && codeBlockRenderers[i].pluginId === pid) {
      codeBlockRenderers.splice(i, 1);
    }
  }
  codeBlockRenderers.push({ ...r, pluginId: pid ?? 'unknown' });
  notifyCodeBlockRenderersChanged();
}

export function unregisterCodeBlockRenderers(pluginId: string): void {
  let changed = false;
  for (let i = codeBlockRenderers.length - 1; i >= 0; i--) {
    if (codeBlockRenderers[i].pluginId === pluginId) {
      codeBlockRenderers.splice(i, 1);
      changed = true;
    }
  }
  if (changed) notifyCodeBlockRenderersChanged();
}

/** 返回某语言已注册的渲染器（第一个命中），无则返回 undefined */
export function getCodeBlockRenderer(lang: string): CodeBlockRenderer | undefined {
  return codeBlockRenderers.find((r) => r.lang === lang);
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
        unregisterCodeBlockRenderers(pluginId);
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

let currentPluginUICleanup: (() => void) | null = null;

/** 加载全部已启用插件的 UI，返回批量卸载函数。
 * 重复调用会先卸载上一次加载的 UI，避免同一插件被多次注册。
 */
export async function loadAllPluginUI(): Promise<() => void> {
  currentPluginUICleanup?.();
  currentPluginUICleanup = null;
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
  const cleanup = () => {
    for (const c of cleanups) c();
  };
  currentPluginUICleanup = cleanup;
  return cleanup;
}
