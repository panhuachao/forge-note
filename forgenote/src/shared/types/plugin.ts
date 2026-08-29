// 插件系统类型定义（doc/插件技术实现方案.md）
// 主进程与渲染进程共用。
import type { AISkill } from './ai-skill';
import type { MCPTool, ToolHandler } from './mcp';
import type { AIRequest, AIResponse, ConfirmableAction } from './ai';
import type { VersionListItem } from './version';

/* ==================== 权限 ==================== */

export type PluginPermission =
  /** 读取知识库笔记与目录树 */
  | 'fs:read'
  /** 创建/修改/删除/移动笔记 */
  | 'fs:write'
  /** 调用已配置的 AI 模型（会产生费用） */
  | 'ai:call'
  /** 注册 MCP 工具供 AI 调用 */
  | 'ai:tool'
  /** 注册 Skill */
  | 'ai:skill'
  /** 注册需确认的操作 */
  | 'action:register'
  /** 侧栏卡片插槽 */
  | 'ui:sidebar'
  /** 主菜单项插槽 */
  | 'ui:menu'
  /** 自定义页面插槽 */
  | 'ui:view'
  /** 设置 Tab 插槽 */
  | 'ui:settings'
  /** 状态栏插槽 */
  | 'ui:statusbar'
  /** 编辑器扩展插槽 */
  | 'ui:editor'
  /** 插件私有持久化存储 */
  | 'storage'
  /** 发起外部网络请求（高风险，需二次确认） */
  | 'network';

/** 需要二次确认的高风险权限 */
export const HIGH_RISK_PERMISSIONS: PluginPermission[] = ['network', 'fs:write'];

export const PERMISSION_LABEL: Record<PluginPermission, string> = {
  'fs:read': '读取笔记',
  'fs:write': '修改 / 删除笔记',
  'ai:call': '调用 AI 模型',
  'ai:tool': '注册 AI 工具',
  'ai:skill': '注册 AI 技能',
  'action:register': '注册确认操作',
  'ui:sidebar': '侧栏面板',
  'ui:menu': '主菜单项',
  'ui:view': '自定义页面',
  'ui:settings': '设置页签',
  'ui:statusbar': '状态栏',
  'ui:editor': '编辑器扩展',
  storage: '插件数据存储',
  network: '访问网络'
};

/* ==================== 清单 ==================== */

export interface PluginManifest {
  /** 全局唯一 id，建议 `作者-功能` 命名，需与目录名一致 */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** 最低应用版本，低于此版本拒绝加载 */
  minAppVersion?: string;
  /** 插件 API 版本 */
  apiVersion: number;
  /** 主进程入口（相对插件目录），CommonJS */
  main: string;
  /** 渲染层入口（相对插件目录），可选 */
  ui?: string;
  /** 声明式权限 */
  permissions: PluginPermission[];
}

/* ==================== 运行时状态 ==================== */

export type PluginState =
  /** 已安装但未启用 */
  | 'disabled'
  /** 已启用且加载成功 */
  | 'active'
  /** 加载或运行出错，已自动禁用 */
  | 'error'
  /** 已声明权限但用户尚未确认 */
  | 'pending-permission';

/** 渲染层展示用的插件信息 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  manifest: PluginManifest;
  state: PluginState;
  error?: string;
  /** 当前知识库是否启用 */
  enabledInKb: boolean;
  /** 用户已授权的权限（已确认过的） */
  grantedPermissions: PluginPermission[];
}

/* ==================== 贡献项（用于卸载时批量撤销） ==================== */

export interface PluginContributions {
  skills: string[];
  tools: string[];
  actionTypes: string[];
  commands: string[];
  uiSlots: string[];
  eventUnsubscribers: (() => void)[];
}

/* ==================== 插件 API ==================== */

export interface CommandCtx {
  kbId?: string;
  notePath?: string;
}

export interface CommandDef {
  title: string;
  hotkey?: string;
  handler: (ctx: CommandCtx) => void | Promise<void>;
}

export interface SidebarPanelDef {
  id: string;
  title: string;
  /** 插件用原生 DOM 渲染，不暴露 React 以避免与宿主版本耦合 */
  render: (container: HTMLElement) => void;
}

export interface MenuItemDef {
  id: string;
  label: string;
  /** 仅可使用宿主内置图标名 */
  icon?: string;
  onClick: () => void;
}

export interface ViewDef {
  id: string;
  title: string;
  render: (container: HTMLElement) => void;
}

export interface SettingTabDef {
  id: string;
  title: string;
  render: (container: HTMLElement) => void;
}

export interface StatusBarDef {
  id: string;
  render: (container: HTMLElement) => void;
}

/** 主进程侧插件 API（按权限装配，未声明的能力直接抛错） */
export interface PluginAPI {
  readonly apiVersion: number;
  readonly pluginId: string;

  fs: {
    readNote(kbId: string, notePath: string): Promise<{ content: string; frontmatter: Record<string, unknown> }>;
    writeNote(kbId: string, notePath: string, content: string): Promise<void>;
    listNotes(kbId: string, opts?: { dirPath?: string; sinceDays?: number }): Promise<{ path: string; title: string; mtime: number }[]>;
    moveNote(kbId: string, fromPath: string, toDirPath: string): Promise<string>;
    deleteNote(kbId: string, notePath: string): Promise<void>;
  };

  kb: {
    list(): Promise<{ id: string; name: string; rootPath: string }[]>;
  };

  version: {
    list(kbId: string, notePath: string): Promise<VersionListItem[]>;
    create(kbId: string, notePath: string, note?: string): Promise<string | null>;
    restore(kbId: string, notePath: string, versionId: string): Promise<{ ok: boolean; message: string }>;
  };

  ai: {
    run(req: AIRequest): Promise<AIResponse>;
    registerTool(tool: MCPTool, handler: ToolHandler): void;
    registerSkill(skill: AISkill): void;
  };

  actions: {
    register(type: string, handler: { preview?: unknown; execute: unknown }): void;
    create(action: ConfirmableAction): void;
  };

  commands: {
    register(id: string, def: CommandDef): void;
  };

  storage: {
    get<T>(key: string, fallback?: T): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };

  ui: {
    toast(msg: { level: 'info' | 'success' | 'warn' | 'error'; text: string }): void;
  };
}

/** 插件上下文（生命周期回调第二个参数） */
export interface PluginContext {
  /** 插件目录绝对路径 */
  readonly dir: string;
  readonly manifest: PluginManifest;

  events: {
    /** 文件变更；返回取消订阅函数 */
    onFsChange(cb: (e: { kbId: string; type: string; path: string; isDir?: boolean; to?: string }) => void): () => void;
    on(event: string, cb: (payload: unknown) => void): () => void;
  };

  log: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

/** 主进程插件入口模块形状 */
export interface PluginMainModule {
  onload(api: PluginAPI, ctx: PluginContext): void | Promise<void>;
  onunload?(api: PluginAPI, ctx: PluginContext): void | Promise<void>;
}

/** 渲染层插件入口模块形状 */
export interface PluginUIModule {
  onload(api: PluginUIAPI): void;
  onunload?(api: PluginUIAPI): void;
}

/** 渲染层插件可用 API（仅 DOM + IPC，无 Node） */
export interface PluginUIAPI {
  readonly pluginId: string;
  ui: {
    registerSidebarPanel(def: SidebarPanelDef): void;
    registerMenuItem(def: MenuItemDef): void;
    registerView(def: ViewDef): void;
    registerSettingTab(def: SettingTabDef): void;
    registerStatusBar(def: StatusBarDef): void;
    toast(msg: { level: 'info' | 'success' | 'warn' | 'error'; text: string }): void;
  };
}
