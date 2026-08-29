// 插件 API 装配与权限门（doc/插件技术实现方案.md §8.2 / §9）
//
// 安全模型说明：主进程 sandbox=false，插件以 require() 载入主进程，
// 因此插件本质上拥有主进程全部能力，权限声明无法从技术上阻止其绕过 API。
// 权限门的作用是：① 让「善意插件」误用 API 时立刻报错；② 向用户清晰展示插件意图。
// 真正的安全依赖安装时的用户确认 + 审计可追溯 + 一键禁用。
import * as path from 'node:path';
import { EventEmitter } from 'events';
import type {
  PluginAPI,
  PluginContext,
  PluginManifest,
  PluginPermission
} from '@shared/types/plugin';
import { fsService } from './fs-service';
import { versionService } from './version-service';
import { aiHub } from './ai-hub';
import { actionService } from './confirmable-action-service';
import { scanNotes, registerTool } from './tool-runtime';
import { registerSkill } from './skill-engine';
import { eventBus } from '../utils/event-bus';
import { auditService } from './audit-service';
import { getPluginValue, setPluginValue, removePluginValue } from './plugin-storage';

/** 当前插件 API 版本 */
export const PLUGIN_API_VERSION = 1;

export interface ApiBuildOptions {
  manifest: PluginManifest;
  /** 用户已授予的权限 */
  granted: Set<PluginPermission>;
  /** 该插件的贡献项收集器（宿主用于卸载时批量撤销） */
  contributions: {
    skills: string[];
    tools: string[];
    actionTypes: string[];
    commands: string[];
    uiSlots: string[];
  };
  /** 事件取消订阅函数收集器 */
  unsubscribers: (() => void)[];
}

/**
 * 按已授予权限装配 API。
 * 未声明权限的能力根本不会返回可用函数——调用时直接抛错。
 */
export function buildPluginApi(opts: ApiBuildOptions): PluginAPI {
  const { manifest, granted, contributions, unsubscribers } = opts;
  const pid = manifest.id;

  const allow = (p: PluginPermission): boolean => granted.has(p);

  const deny = (p: PluginPermission) => (): never => {
    throw new Error(`插件「${manifest.name}」未声明权限 ${p}，无法调用该能力`);
  };

  return {
    apiVersion: PLUGIN_API_VERSION,
    pluginId: pid,

    fs: {
      readNote: allow('fs:read')
        ? async (kbId, notePath) => {
            const c = await fsService.readNote(kbId, notePath);
            return { content: c.content, frontmatter: c.frontmatter ?? {} };
          }
        : deny('fs:read'),

      writeNote: allow('fs:write')
        ? async (kbId, notePath, content) => {
            await fsService.writeNote(kbId, notePath, content);
            auditService.record(kbId, 'forge', { path: notePath, via: 'plugin' }, `plugin:${pid}`);
          }
        : deny('fs:write'),

      listNotes: allow('fs:read')
        ? async (kbId, o) => {
            const all = scanNotes(kbId);
            let list = all;
            if (o?.dirPath) list = list.filter((n) => (n.dir || '') === o.dirPath);
            if (o?.sinceDays) {
              const ts = Date.now() - o.sinceDays * 86400_000;
              list = list.filter((n) => n.mtime >= ts);
            }
            return list.map((n) => ({ path: n.path, title: n.title, mtime: n.mtime }));
          }
        : deny('fs:read'),

      moveNote: allow('fs:write')
        ? async (kbId, fromPath, toDirPath) => fsService.moveNote(kbId, fromPath, toDirPath)
        : deny('fs:write'),

      deleteNote: allow('fs:write')
        ? async (kbId, notePath) => {
            await fsService.deleteNote(kbId, notePath);
            auditService.record(kbId, 'forge', { path: notePath, via: 'plugin', op: 'delete' }, `plugin:${pid}`);
          }
        : deny('fs:write')
    },

    kb: {
      list: async () => {
        // 知识库列表读取不涉敏感内容，无需额外权限
        const { listKBs } = await import('./store');
        return (listKBs() ?? []).map((k) => ({ id: k.id, name: k.name, rootPath: k.rootPath }));
      }
    },

    version: {
      list: allow('fs:read')
        ? (kbId, notePath) => versionService.list(kbId, notePath)
        : deny('fs:read'),
      create: allow('fs:write')
        ? (kbId, notePath, note) => versionService.create(kbId, notePath, { source: 'manual', note, force: true })
        : deny('fs:write'),
      restore: allow('fs:write')
        ? (kbId, notePath, versionId) => versionService.restore(kbId, notePath, versionId)
        : deny('fs:write')
    },

    ai: {
      run: allow('ai:call') ? (req) => aiHub.run(req) : deny('ai:call'),

      registerTool: allow('ai:tool')
        ? (tool, handler) => {
            registerTool(tool, handler, pid);
            contributions.tools.push(tool.name);
          }
        : deny('ai:tool'),

      registerSkill: allow('ai:skill')
        ? (skill) => {
            registerSkill(skill, pid);
            contributions.skills.push(skill.id);
          }
        : deny('ai:skill')
    },

    actions: {
      register: allow('action:register')
        ? (type, handler) => {
            actionService.register(type, handler as never);
            contributions.actionTypes.push(type);
          }
        : deny('action:register'),

      create: allow('action:register')
        ? (action) => {
            // 不直接执行：把 action 推给渲染层展示确认卡片，
            // 用户确认后由渲染层调用 AI_ACTION_EXECUTE 真正执行（方案 §7.1）。
            eventBus.emit('plugin:confirmAction', { pluginId: pid, action });
          }
        : deny('action:register')
    },

    commands: {
      register: (id, def) => {
        // 命令面板不涉敏感数据，无需权限
        contributions.commands.push(id);
        commandRegistry.set(`${pid}:${id}`, { ...def, pluginId: pid });
      }
    },

    storage: {
      get: allow('storage')
        ? (key, fallback) => getPluginValue(pid, key, fallback)
        : deny('storage'),
      set: allow('storage')
        ? (key, value) => setPluginValue(pid, key, value)
        : deny('storage'),
      remove: allow('storage')
        ? (key) => removePluginValue(pid, key)
        : deny('storage')
    },

    ui: {
      toast: (msg) => {
        // 通过事件总线转发到渲染层（由 ipc.ts 订阅后 webContents.send）
        eventBus.emit('plugin:toast', { pluginId: pid, ...msg });
      }
    }
  };
}

/* ==================== 命令注册表（方案 §7.3） ==================== */

export interface RegisteredCommand {
  pluginId: string;
  title: string;
  hotkey?: string;
  handler: (ctx: { kbId?: string; notePath?: string }) => void | Promise<void>;
}

export const commandRegistry = new Map<string, RegisteredCommand>();

export function unregisterCommandsByOwner(pluginId: string): void {
  for (const [k, v] of commandRegistry) {
    if (v.pluginId === pluginId) commandRegistry.delete(k);
  }
}

/* ==================== 插件上下文 ==================== */

export function buildPluginContext(manifest: PluginManifest, dir: string, unsubscribers: (() => void)[]): PluginContext {
  const prefix = `[plugin:${manifest.id}]`;

  const on = (emitter: EventEmitter, ev: string, cb: (...a: unknown[]) => void): (() => void) => {
    emitter.on(ev, cb);
    const off = () => emitter.off(ev, cb);
    unsubscribers.push(off);
    return off;
  };

  return {
    dir,
    manifest,
    events: {
      onFsChange: (cb) => on(eventBus, 'fsChange', cb as (...a: unknown[]) => void),
      on: (event, cb) => on(eventBus, event, cb as (...a: unknown[]) => void)
    },
    log: {
      info: (...args) => console.log(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args)
    }
  };
}

/** 插件解析自己目录下的资源路径（防目录穿越） */
export function resolvePluginResource(pluginDir: string, rel: string): string {
  const abs = path.resolve(pluginDir, rel);
  if (!abs.startsWith(path.resolve(pluginDir))) {
    throw new Error('插件资源路径越界');
  }
  return abs;
}
