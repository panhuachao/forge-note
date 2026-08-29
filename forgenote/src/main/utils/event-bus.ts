// 主进程内事件总线
//
// 原本是一个裸 EventEmitter，没有事件名常量与 payload 类型，
// 且 fsChange 的 payload 不含 kbId——多知识库场景下监听方无法区分事件来源。
// 插件系统依赖这些事件，因此这里补上类型定义。
import { EventEmitter } from 'events';

export type FsChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'renameDir';

export interface FsChangeEvent {
  /** 知识库 id：多知识库场景必需 */
  kbId: string;
  type: FsChangeType;
  /** 知识库内相对路径 */
  path: string;
  isDir?: boolean;
  /** 仅 renameDir：新路径 */
  to?: string;
}

/** 应用事件表：新增事件请在此登记，便于类型检查 */
export interface AppEventMap {
  fsChange: FsChangeEvent;
  'note:open': { kbId: string; notePath: string };
  'note:close': { kbId: string; notePath: string };
  'kb:switch': { kbId: string };
  /** 插件请求弹 toast */
  'plugin:toast': { pluginId: string; level: 'info' | 'success' | 'warn' | 'error'; text: string };
  /** 插件请求用户确认一个操作 */
  'plugin:confirmAction': { pluginId: string; action: unknown };
}

export const eventBus = new EventEmitter();

/** 类型安全的订阅，返回取消订阅函数 */
export function onEvent<K extends keyof AppEventMap>(
  event: K,
  cb: (payload: AppEventMap[K]) => void
): () => void {
  eventBus.on(event, cb as (...a: unknown[]) => void);
  return () => eventBus.off(event, cb as (...a: unknown[]) => void);
}

/** 类型安全的发布 */
export function emitEvent<K extends keyof AppEventMap>(event: K, payload: AppEventMap[K]): void {
  eventBus.emit(event, payload);
}

// 监听器上限：插件可能注册较多监听，避免 Node 默认 10 个的告警
eventBus.setMaxListeners(100);
