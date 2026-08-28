// 通用「需确认操作」注册表（doc/MCP技术实现方案.md §5.5）
// AI 产出 ConfirmableAction（pending）→ 用户确认 → 由本服务按 type 分派到对应 handler 执行。
// 新增一种确认类操作只需：① 在此注册 handler ② 渲染层加一张卡片分支，主干逻辑零改动。
import type { ConfirmableAction, NotePatchPayload, NotePatchPreview } from '@shared/types/ai';
import { previewNotePatch, applyNotePatch, getStoredPreview } from './note-patch';

export interface ActionCtx {
  kbId?: string;
  /** 产生该草稿的会话 id（审计回溯用） */
  sessionId?: string;
  /** 草稿 id */
  draftId?: string;
}

export interface ActionHandler<P = unknown, V = unknown> {
  /** 生成预览数据（可选） */
  preview?: (payload: P, ctx: ActionCtx) => Promise<V | null>;
  /** 真正执行（仅在用户确认后调用） */
  execute: (payload: P, ctx: ActionCtx) => Promise<unknown>;
}

class ConfirmableActionService {
  private handlers = new Map<string, ActionHandler<any, any>>();

  register<P, V = unknown>(type: string, handler: ActionHandler<P, V>): void {
    this.handlers.set(type, handler as ActionHandler<any, any>);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /** 为 action 填装 preview（供渲染层展示） */
  async preview(action: ConfirmableAction, ctx: ActionCtx): Promise<unknown | null> {
    const h = this.handlers.get(action.type);
    if (!h?.preview) return null;
    try {
      return await h.preview(action.payload, ctx);
    } catch (e) {
      console.warn('[confirmable-action] preview 失败', action.type, e);
      return null;
    }
  }

  /** 执行 action（仅应在用户确认后调用） */
  async execute(action: ConfirmableAction, ctx: ActionCtx): Promise<unknown> {
    const h = this.handlers.get(action.type);
    if (!h) return { ok: false, message: `未注册的确认操作类型: ${action.type}` };
    return await h.execute(action.payload, { ...ctx, draftId: action.id });
  }
}

export const actionService = new ConfirmableActionService();

/* ==================== 内置 handler：笔记 Patch ==================== */
actionService.register<NotePatchPayload, NotePatchPreview>('notePatch', {
  // 若 payload 带 previewId（模型先调过 kb_preview_patch），直接复用已有预览，避免重复生成 diff
  preview: async (payload, ctx) => {
    if (payload?.previewId) {
      const stored = getStoredPreview(payload.previewId);
      if (stored) return stored;
    }
    if (!payload?.notePath || !payload?.ops?.length || !ctx.kbId) return null;
    return await previewNotePatch(ctx.kbId, payload.notePath, payload.ops);
  },
  execute: async (payload, ctx) => {
    if (!ctx.kbId) return { ok: false, message: '缺少知识库上下文' };
    if (!payload?.notePath) return { ok: false, message: '缺少 notePath' };
    return await applyNotePatch(ctx.kbId, payload.notePath, payload.ops ?? [], payload.previewId);
  }
});

/* ==================== 内置 handler：移动笔记 ==================== */
actionService.register<{ fromPath: string; toDirPath: string; autoCreateDir?: boolean }>('moveNote', {
  preview: async (payload) => ({
    fromPath: payload?.fromPath,
    toDirPath: payload?.toDirPath,
    hint: `将把「${payload?.fromPath}」移动到「${payload?.toDirPath || '根目录'}」`
  }),
  execute: async (payload, ctx) => {
    if (!ctx.kbId) return { ok: false, message: '缺少知识库上下文' };
    if (!payload?.fromPath) return { ok: false, message: '缺少 fromPath' };
    const { fsService } = await import('./fs-service');
    const toPath = await fsService.moveNote(ctx.kbId, payload.fromPath, payload.toDirPath || '', {
      autoCreateDir: payload.autoCreateDir
    });
    const { auditService } = await import('./audit-service');
    auditService.record(ctx.kbId, 'confirmableAction', {
      type: 'moveNote',
      fromPath: payload.fromPath,
      toPath,
      by: 'ai'
    });
    return { ok: true, message: `已移动：${payload.fromPath} → ${toPath}`, toPath };
  }
});

/* ==================== 内置 handler：新建笔记 ==================== */
actionService.register<{ dirPath: string; name: string; content?: string }>('createNote', {
  preview: async (payload) => ({
    dirPath: payload?.dirPath,
    name: payload?.name,
    hint: `将在「${payload?.dirPath || '根目录'}」下新建笔记「${payload?.name}」`
  }),
  execute: async (payload, ctx) => {
    if (!ctx.kbId) return { ok: false, message: '缺少知识库上下文' };
    if (!payload?.name) return { ok: false, message: '缺少笔记名' };
    const { fsService } = await import('./fs-service');
    const created = await fsService.createNote(ctx.kbId, payload.dirPath || '', { name: payload.name });
    if (payload.content) {
      await fsService.writeNote(ctx.kbId, created.path, payload.content);
    }
    const { auditService } = await import('./audit-service');
    auditService.record(ctx.kbId, 'confirmableAction', {
      type: 'createNote',
      notePath: created.path,
      by: 'ai'
    });
    return { ok: true, message: `已新建笔记：${created.path}`, notePath: created.path };
  }
});

/* ==================== 内置 handler：更新设置 ==================== */
// 示例扩展点：AI 可建议修改应用配置（需用户确认后写入 app_config）
actionService.register<{ key: string; value: unknown }>('settingUpdate', {
  preview: async (payload) => ({
    key: payload?.key,
    value: payload?.value,
    hint: `将把配置项「${payload?.key}」更新为新值`
  }),
  execute: async (payload) => {
    if (!payload?.key) return { ok: false, message: '缺少配置项 key' };
    // 延迟引入，避免模块初始化期依赖 store
    const { setConfig } = await import('./store');
    setConfig(payload.key, payload.value);
    return { ok: true, message: `已更新配置：${payload.key}` };
  }
});
