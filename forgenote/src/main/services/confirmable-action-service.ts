// 通用「需确认操作」注册表（doc/MCP技术实现方案.md §5.5）
// AI 产出 ConfirmableAction（pending）→ 用户确认 → 由本服务按 type 分派到对应 handler 执行。
// 新增一种确认类操作只需：① 在此注册 handler ② 渲染层加一张卡片分支，主干逻辑零改动。
import type {
  ConfirmableAction,
  NotePatchPayload,
  NotePatchPreview,
  BatchPatchPayload,
  BatchPatchPreview,
  BatchMovePayload,
  BatchRetagPayload
} from '@shared/types/ai';
import {
  previewNotePatch,
  applyNotePatch,
  getStoredPreview,
  saveSnapshot,
  restoreSnapshot,
  verifyPatch
} from './note-patch';
import { versionService } from './version-service';

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
  /**
   * 执行后自动校验（可选，doc/AI智能管家重构方案.md §6.3 P2-3）。
   * 返回 ok=false 时渲染层提示「似乎未生效，可回滚」。
   */
  verify?: (payload: P & ActionRollbackInfo, ctx: ActionCtx) => Promise<{ ok: boolean; message: string }>;
  /** 回滚（可选）：用户触发撤销时调用 */
  rollback?: (payload: P & ActionRollbackInfo, ctx: ActionCtx) => Promise<{ ok: boolean; message: string }>;
}

/** 执行 / 回滚时回填给 handler 的凭证（由本服务维护，模型与渲染层不感知） */
export interface ActionRollbackInfo {
  snapshotId?: string;
  snapshots?: { id: string; notePath: string }[];
}

/** 已执行操作的回滚凭证（按 action.id 索引，对渲染层透明） */
interface ExecRecord {
  type: string;
  payload: unknown;
  /** 单条操作的快照 */
  snapshotId?: string;
  /** 批量操作的快照（回滚时逆序恢复） */
  snapshots?: { id: string; notePath: string }[];
  at: number;
}

class ConfirmableActionService {
  private handlers = new Map<string, ActionHandler<any, any>>();
  /** action.id → 执行记录（含回滚快照 id） */
  private executed = new Map<string, ExecRecord>();

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

  /** 执行 action（仅应在用户确认后调用）；记录回滚凭证 */
  async execute(action: ConfirmableAction, ctx: ActionCtx): Promise<unknown> {
    const h = this.handlers.get(action.type);
    if (!h) return { ok: false, message: `未注册的确认操作类型: ${action.type}` };
    const r = await h.execute(action.payload, { ...ctx, draftId: action.id });
    const snapshotId = (r as { snapshotId?: string } | null)?.snapshotId;
    const snapshots = (r as { snapshots?: { id: string; notePath: string }[] } | null)?.snapshots;
    if (h.rollback) {
      this.executed.set(action.id, {
        type: action.type,
        payload: action.payload,
        snapshotId,
        snapshots,
        at: Date.now()
      });
    }
    return r;
  }

  /**
   * 执行后验证（P2-3）。无 verify 实现时视为通过，不阻断流程。
   */
  async verify(action: ConfirmableAction, ctx: ActionCtx): Promise<{ ok: boolean; message: string }> {
    const h = this.handlers.get(action.type);
    if (!h?.verify) return { ok: true, message: '该操作无需验证' };
    const rec = this.executed.get(action.id);
    try {
      return await h.verify({ ...(action.payload as object), snapshotId: rec?.snapshotId } as never, ctx);
    } catch (e) {
      return { ok: false, message: `验证出错：${String(e)}` };
    }
  }

  /**
   * 回滚已执行的操作（P2-3）。快照由 execute 阶段保存，对渲染层透明。
   */
  async rollback(action: ConfirmableAction, ctx: ActionCtx): Promise<{ ok: boolean; message: string }> {
    const h = this.handlers.get(action.type);
    if (!h?.rollback) return { ok: false, message: `该操作类型不支持回滚：${action.type}` };
    const rec = this.executed.get(action.id);
    if (!rec) return { ok: false, message: '未找到该操作的执行记录，无法回滚' };
    try {
      const r = await h.rollback(
        { ...(rec.payload as object), snapshotId: rec.snapshotId, snapshots: rec.snapshots } as never,
        ctx
      );
      if (r.ok) this.executed.delete(action.id);
      return r;
    } catch (e) {
      return { ok: false, message: `回滚出错：${String(e)}` };
    }
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
    // AI 改笔记前先存一个版本：内存快照只保 1 小时，版本历史才能长期回溯
    // （doc/笔记版本实现方案.md §9.1）
    void versionService.create(ctx.kbId, payload.notePath, { source: 'ai', force: true });
    // 先存快照再改：为回滚留后路（P2-3）
    const snapshotId = await saveSnapshot(ctx.kbId, payload.notePath);
    const r = await applyNotePatch(ctx.kbId, payload.notePath, payload.ops ?? [], payload.previewId);
    return { ...r, snapshotId, ops: r.ops };
  },
  /** 执行后回读校验：确认每处修改真的落到了笔记里 */
  verify: async (payload, ctx) => {
    if (!ctx.kbId || !payload?.notePath) return { ok: false, message: '缺少知识库或笔记路径' };
    const ops = payload.ops ?? [];
    if (!ops.length) return { ok: true, message: '无可校验的修改项' };
    return await verifyPatch(ctx.kbId, payload.notePath, ops);
  },
  /** 按快照恢复修改前的内容 */
  rollback: async (payload) => {
    if (!payload?.snapshotId) return { ok: false, message: '缺少回滚快照，可能已过期' };
    return await restoreSnapshot(payload.snapshotId);
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

/* ==================== 内置 handler：批量修改笔记（P2-4） ==================== */
actionService.register<BatchPatchPayload, BatchPatchPreview>('batchPatch', {
  preview: async (payload, ctx) => {
    if (!ctx.kbId || !payload?.items?.length) return null;
    const items: NotePatchPreview[] = [];
    for (const it of payload.items) {
      if (!it?.notePath || !it.ops?.length) continue;
      try {
        items.push(await previewNotePatch(ctx.kbId, it.notePath, it.ops));
      } catch {
        /* 单篇预览失败不影响整体 */
      }
    }
    return { items, applicable: items.filter((i) => i.canApply).length };
  },
  execute: async (payload, ctx) => {
    if (!ctx.kbId) return { ok: false, message: '缺少知识库上下文' };
    const items = payload?.items ?? [];
    if (!items.length) return { ok: false, message: '没有待执行的修改项' };

    // 批量修改前为每篇笔记存一个版本，便于事后逐篇回溯
    for (const it of items) {
      if (it?.notePath) {
        void versionService.create(ctx.kbId, it.notePath, { source: 'ai', force: true });
      }
    }

    const snapshots: { id: string; notePath: string }[] = [];
    const failed: { item: unknown; reason: string }[] = [];
    let succeeded = 0;
    for (const it of items) {
      if (!it?.notePath) {
        failed.push({ item: it, reason: '缺少 notePath' });
        continue;
      }
      try {
        // 先存快照，保证回滚可用
        const sid = await saveSnapshot(ctx.kbId, it.notePath);
        const r = await applyNotePatch(ctx.kbId, it.notePath, it.ops ?? [], it.previewId);
        if (r.ok) {
          succeeded++;
          if (sid) snapshots.push({ id: sid, notePath: it.notePath });
        } else {
          failed.push({ item: it.notePath, reason: r.message });
        }
      } catch (e) {
        failed.push({ item: it.notePath, reason: String(e) });
      }
    }
    const { auditService } = await import('./audit-service');
    auditService.record(ctx.kbId, 'confirmableAction', {
      type: 'batchPatch',
      total: items.length,
      succeeded,
      by: 'ai'
    });
    return {
      batchId: `batch_${Date.now().toString(36)}`,
      total: items.length,
      succeeded,
      failed,
      canRollback: snapshots.length > 0,
      snapshots,
      ok: succeeded > 0,
      message: `批量修改完成：成功 ${succeeded} / ${items.length}${failed.length ? `，失败 ${failed.length}` : ''}`
    };
  },
  rollback: async (payload) => {
    const snaps = payload?.snapshots ?? [];
    if (!snaps.length) return { ok: false, message: '没有可回滚的快照' };
    // 逆序恢复，避免相互覆盖
    let ok = true;
    const msgs: string[] = [];
    for (let i = snaps.length - 1; i >= 0; i--) {
      const r = await restoreSnapshot(snaps[i].id);
      if (!r.ok) {
        ok = false;
        msgs.push(r.message);
      }
    }
    return { ok, message: ok ? `已回滚 ${snaps.length} 篇笔记` : `回滚部分失败：${msgs.join('；')}` };
  }
});

/* ==================== 内置 handler：批量移动笔记（P2-4） ==================== */
actionService.register<BatchMovePayload>('batchMove', {
  preview: async (payload) => ({
    items: payload?.items ?? [],
    hint: `将移动 ${payload?.items?.length ?? 0} 篇笔记到各自目标目录`
  }),
  execute: async (payload, ctx) => {
    if (!ctx.kbId) return { ok: false, message: '缺少知识库上下文' };
    const items = payload?.items ?? [];
    if (!items.length) return { ok: false, message: '没有待移动的笔记' };
    const { fsService } = await import('./fs-service');
    const failed: { item: unknown; reason: string }[] = [];
    const moved: { fromPath: string; toPath: string }[] = [];
    for (const it of items) {
      try {
        const toPath = await fsService.moveNote(ctx.kbId, it.fromPath, it.toDirPath || '', {
          autoCreateDir: it.autoCreateDir
        });
        moved.push({ fromPath: it.fromPath, toPath });
      } catch (e) {
        failed.push({ item: it.fromPath, reason: String(e) });
      }
    }
    const { auditService } = await import('./audit-service');
    auditService.record(ctx.kbId, 'confirmableAction', {
      type: 'batchMove',
      total: items.length,
      succeeded: moved.length,
      by: 'ai'
    });
    return {
      batchId: `batch_${Date.now().toString(36)}`,
      total: items.length,
      succeeded: moved.length,
      failed,
      canRollback: false, // 移动可通过反向移动撤销，暂不自动支持
      moved,
      ok: moved.length > 0,
      message: `批量移动完成：成功 ${moved.length} / ${items.length}${failed.length ? `，失败 ${failed.length}` : ''}`
    };
  }
});

/* ==================== 内置 handler：批量打标签（P2-4） ==================== */
actionService.register<BatchRetagPayload>('batchRetag', {
  preview: async (payload) => ({
    items: payload?.items ?? [],
    hint: `将为 ${payload?.items?.length ?? 0} 篇笔记补充标签`
  }),
  execute: async (payload, ctx) => {
    if (!ctx.kbId) return { ok: false, message: '缺少知识库上下文' };
    const items = payload?.items ?? [];
    if (!items.length) return { ok: false, message: '没有待处理的笔记' };
    const { fsService } = await import('./fs-service');
    const failed: { item: unknown; reason: string }[] = [];
    let succeeded = 0;
    for (const it of items) {
      try {
        const cur = await fsService.readNote(ctx.kbId, it.notePath);
        const existing = Array.isArray(cur.frontmatter?.tags) ? (cur.frontmatter.tags as string[]).map(String) : [];
        const merged = Array.from(new Set([...existing, ...it.tags.map(String)]));
        await fsService.updateTags(ctx.kbId, it.notePath, merged);
        succeeded++;
      } catch (e) {
        failed.push({ item: it.notePath, reason: String(e) });
      }
    }
    const { auditService } = await import('./audit-service');
    auditService.record(ctx.kbId, 'confirmableAction', {
      type: 'batchRetag',
      total: items.length,
      succeeded,
      by: 'ai'
    });
    return {
      batchId: `batch_${Date.now().toString(36)}`,
      total: items.length,
      succeeded,
      failed,
      canRollback: false,
      ok: succeeded > 0,
      message: `批量打标签完成：成功 ${succeeded} / ${items.length}${failed.length ? `，失败 ${failed.length}` : ''}`
    };
  }
});
