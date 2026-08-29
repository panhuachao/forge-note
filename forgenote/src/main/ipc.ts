// IPC 处理器 - 注册所有 ipcMain.handle
import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import { IPC } from '@shared/ipc-channels';
import { listKBs, getKB, addKB as storeAddKB, removeKB as storeRemoveKB, getConfig, setConfig, getAIPresets, saveAIPreset, setActiveAIPreset } from './services/store';
import { kbService } from './services/kb-service';
import { fsService } from './services/fs-service';
import { eventBus } from './utils/event-bus';
import { linkIndex } from './services/link-index';
import { templateService } from './services/template-service';
import { aiService } from './services/ai-service';
import { aiHub } from './services/ai-hub';
import { searchService } from './services/search-service';
import { auditService } from './services/audit-service';
import { profileService } from './services/profile-service';
import { agentRegistry } from './services/agents/registry';
import { actionService } from './services/confirmable-action-service';
import {
  runPatrol,
  getCachedReport,
  getPendingSuggestions,
  markSuggestionsShown
} from './services/patrol-service';
import { versionService } from './services/version-service';
import { pluginHost, forwardPluginEvents } from './services/plugin-host';
import { commandRegistry } from './services/plugin-api';
import type { UserProfile } from '@shared/types/profile';
import type { AIPrompts } from '@shared/types/ai';
import { checkForUpdates, downloadAndInstall, quitAndInstall, setAutoCheckEnabled } from './services/updater';

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
  // 确认操作扩展点 openDialog：AI 建议「打开某个弹窗」，用户确认后由主进程通知渲染层
  // （doc/MCP技术实现方案.md §8）
  actionService.register<{ dialog: string; params?: Record<string, unknown> }>('openDialog', {
    preview: async (payload) => ({ dialog: payload?.dialog, params: payload?.params ?? {} }),
    execute: async (payload) => {
      getMainWindow()?.webContents.send(IPC.EV_OPEN_DIALOG, {
        dialog: payload?.dialog,
        params: payload?.params ?? {}
      });
      return { ok: true, message: `已请求打开弹窗：${payload?.dialog}` };
    }
  });

  // Window control（标题栏双击最大化 / 最小化 / 关闭）
  ipcMain.handle(IPC.WIN_MAXIMIZE_TOGGLE, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(IPC.WIN_IS_MAXIMIZED, () => {
    const win = getMainWindow();
    return win ? win.isMaximized() : false;
  });
  ipcMain.handle(IPC.WIN_MINIMIZE, () => {
    getMainWindow()?.minimize();
  });
  ipcMain.handle(IPC.WIN_CLOSE, () => {
    getMainWindow()?.close();
  });

  // KB
  ipcMain.handle(IPC.KB_LIST, async () => {
    return await kbService.listAllSummaries();
  });
  ipcMain.handle(IPC.KB_ADD, async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择知识库根目录'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0];
    const name = rootPath.split(/[/\\]/).pop() || '未命名知识库';
    const kb = {
      id: nanoid(8),
      name,
      rootPath,
      createdAt: Date.now()
    };
    storeAddKB(kb);
    // 预热
    await kbService.buildTree(rootPath, kb.id);
    return kb;
  });
  ipcMain.handle(IPC.KB_REMOVE, async (_e, id: string) => {
    storeRemoveKB(id);
  });
  ipcMain.handle(IPC.KB_OPEN, async (_e, id: string) => {
    const kb = getKB(id);
    if (!kb) throw new Error('知识库不存在');
    setConfig('activeKb', id);
    await kbService.buildTree(kb.rootPath, id);
  });
  ipcMain.handle(IPC.KB_GET_ACTIVE, async () => {
    const id = getConfig<string>('activeKb');
    if (!id) return null;
    const kb = getKB(id);
    if (!kb) return null;
    // 根目录已不存在则视为无有效知识库
    if (!(await kbService.kbPathExists(kb.rootPath))) return null;
    return kb;
  });
  ipcMain.handle(IPC.KB_SET_ACTIVE, async (_e, id: string) => {
    setConfig('activeKb', id);
    // 插件按知识库启用：切换 KB 后重新加载该库启用的插件
    await pluginHost.setActiveKb(id);
  });

  // FS
  ipcMain.handle(IPC.FS_LIST_TREE, async (_e, kbId: string) => fsService.listTree(kbId));
  ipcMain.handle(IPC.FS_READ_NOTE, async (_e, kbId: string, p: string) => fsService.readNote(kbId, p));
  ipcMain.handle(IPC.FS_WRITE_NOTE, async (_e, kbId: string, p: string, c: string) => fsService.writeNote(kbId, p, c));
  ipcMain.handle(IPC.FS_UPDATE_TAGS, async (_e, kbId: string, p: string, tags: string[]) => fsService.updateTags(kbId, p, tags));
  ipcMain.handle(IPC.FS_UPDATE_SUMMARY, async (_e, kbId: string, p: string, s: string) => fsService.updateSummary(kbId, p, s));
  ipcMain.handle(IPC.FS_ALL_TAGS, async (_e, kbId: string) => fsService.getAllTags(kbId));
  ipcMain.handle(IPC.FS_CREATE_NOTE, async (_e, kbId: string, dirPath: string, opts?: { useTemplate?: boolean; name?: string }) => fsService.createNote(kbId, dirPath, opts));
  ipcMain.handle(IPC.FS_DELETE_NOTE, async (_e, kbId: string, p: string) => fsService.deleteNote(kbId, p));
  ipcMain.handle(IPC.FS_MOVE_NOTE, async (_e, kbId: string, from: string, to: string, opts?: { autoCreateDir?: boolean }) => fsService.moveNote(kbId, from, to, opts));
  ipcMain.handle(IPC.FS_RENAME_NOTE, async (_e, kbId: string, old: string, name: string) => fsService.renameNote(kbId, old, name));
  ipcMain.handle(IPC.FS_CREATE_DIR, async (_e, kbId: string, parent: string, name: string) => fsService.createDir(kbId, parent, name));
  ipcMain.handle(IPC.FS_DELETE_DIR, async (_e, kbId: string, p: string) => fsService.deleteDir(kbId, p));
  ipcMain.handle(IPC.FS_RENAME_DIR, async (_e, kbId: string, dirPath: string, name: string) => fsService.renameDir(kbId, dirPath, name));
  ipcMain.handle(IPC.FS_READ_TEXT, async (_e, kbId: string, p: string) => fsService.readText(kbId, p));
  ipcMain.handle(IPC.FS_WRITE_TEXT, async (_e, kbId: string, p: string, c: string) => fsService.writeText(kbId, p, c));
  ipcMain.handle(IPC.FS_LIST_TAGS, async (_e, kbId: string) => fsService.listTags(kbId));
  ipcMain.handle(IPC.FS_NOTES_BY_TAG, async (_e, kbId: string, tag: string) => fsService.notesByTag(kbId, tag));

  // Links
  ipcMain.handle(IPC.LINKS_GET_BACKLINKS, async (_e, kbId: string, p: string) => linkIndex.getBacklinks(kbId, p));
  ipcMain.handle(IPC.LINKS_GET_OUTLINKS, async (_e, kbId: string, p: string) => linkIndex.getOutlinks(kbId, p));
  ipcMain.handle(IPC.LINKS_SUGGEST, async (_e, kbId: string, p: string) => aiService.suggestLinks(kbId, p));

  // AI
  ipcMain.handle(IPC.AI_GET_CONFIG, async () => aiService.getConfig());
  ipcMain.handle(IPC.AI_SET_CONFIG, async (_e, cfg) => aiService.setConfig(cfg));
  ipcMain.handle(IPC.AI_GET_PROMPTS, async () => aiService.getPrompts());
  ipcMain.handle(IPC.AI_SET_PROMPTS, async (_e, prompts) => aiService.setPrompts(prompts));
  ipcMain.handle(IPC.AI_ASK, async (_e, kbId: string, q: string, opts) => aiService.ask(kbId, q, opts));
  ipcMain.handle(IPC.AI_SUMMARIZE, async (_e, kbId: string, p: string) => aiService.summarize(kbId, p));
  ipcMain.handle(IPC.AI_GENERATE_TAGS, async (_e, kbId: string, p: string) => aiService.generateTags(kbId, p));
  ipcMain.handle(IPC.AI_SUGGEST_DIR, async (_e, kbId: string, p: string) => aiService.suggestDir(kbId, p));
  ipcMain.handle(IPC.AI_SUGGEST_LINKS, async (_e, kbId: string, p: string) => aiService.suggestLinks(kbId, p));
  ipcMain.handle(IPC.AI_FORGE_CARD, async (_e, kbId: string, p: string) => aiService.forgeCard(kbId, p));

  // 多媒体：图片/音频资源落盘（统一 .assets + 内容 hash 去重）
  ipcMain.handle(IPC.MEDIA_SAVE_IMAGE, async (_e, kbId: string, data: Uint8Array, ext: string) =>
    fsService.saveAsset(kbId, 'image', data, ext)
  );
  ipcMain.handle(IPC.MEDIA_SAVE_AUDIO, async (_e, kbId: string, data: Uint8Array, ext: string) =>
    fsService.saveAsset(kbId, 'audio', data, ext)
  );
  ipcMain.handle(IPC.MEDIA_TRANSCRIBE, async (_e, audioAbs: string) => aiService.transcribe(audioAbs));
  ipcMain.handle(IPC.MEDIA_GEN_TRANSCRIPT, async (_e, kbId: string, audioRelPath: string, text: string) =>
    aiService.generateTranscriptNote(kbId, audioRelPath, text)
  );
  ipcMain.handle(IPC.AI_QUICK_NOTE, async (_e, kbId: string, content: string, opts?: { dirId?: string }) =>
    aiService.quickNote(kbId, content, opts)
  );
  // 统一 AI 调用入口（Skill 路由 + 会话上下文）
  ipcMain.handle(IPC.AI_HUB_RUN, async (_e, req: import('@shared/types/ai').AIRequest) => aiHub.run(req));
  // 多 Agent 方案（§3.5）：渲染层直接按 agentId 调用，无需关心 skill 路由。
  // agentId 优先在 aiHub.run 内解析（agentRegistry 为一等数据源），找不到时回退 skill 路由。
  ipcMain.handle(IPC.AI_RUN_AGENT, async (_e, kbId: string, agentId: string, text: string, extra?: Record<string, unknown>) => {
    // skill 留空：AIHub 内 agentId 优先，会解析为对应 Agent 的临时 Skill
    return aiHub.run({ skill: '', agentId, input: { text }, kbId, extra });
  });
  // 执行后验证 / 回滚（doc/AI智能管家重构方案.md §6.3 P2-3）：
  // 确认 → 执行 之后自动校验修改是否生效，未达预期时用户可一键回滚。
  ipcMain.handle(
    IPC.AI_ACTION_VERIFY,
    async (_e, action: import('@shared/types/ai').ConfirmableAction, kbId?: string) =>
      actionService.verify(action, { kbId })
  );
  ipcMain.handle(
    IPC.AI_ACTION_ROLLBACK,
    async (_e, action: import('@shared/types/ai').ConfirmableAction, kbId?: string) =>
      actionService.rollback(action, { kbId })
  );
  // 直接执行已注册的确认操作：供「巡检建议」这类本地规则生成的 action 使用，
  // 不经过 AIHub，因此无需模型参与（P2-1 / P2-5）。
  ipcMain.handle(
    IPC.AI_ACTION_EXECUTE,
    async (_e, action: import('@shared/types/ai').ConfirmableAction, kbId?: string) =>
      actionService.execute(action, { kbId })
  );
  // 插件系统（doc/插件技术实现方案.md）
  // 恢复用户已授权记录，并扫描插件目录（只登记不加载，加载发生在 setActiveKb 时）
  pluginHost.setAppVersion(app.getVersion());
  pluginHost.restoreGrants();
  // 安全模式：启动时按住 Shift 跳过插件自动加载（方案 §12 阶段四 4.4）
  if (process.argv.includes('--safe-mode') || process.env.FORGENOTE_SAFE_MODE === '1') {
    pluginHost.setSafeMode(true);
    console.log('[plugin] 安全模式：跳过插件加载');
  }
  pluginHost.scan();
  // 主进程启动时主动恢复当前知识库并按 KB 启用状态加载插件，
  // 避免依赖渲染层 setActive 的调用时机导致重启后插件显示为禁用。
  void (async () => {
    const activeKbId = getConfig<string>('activeKb');
    if (activeKbId) await pluginHost.setActiveKb(activeKbId);
  })();
  // 插件 toast / 确认请求 → 转发给渲染层
  forwardPluginEvents((channel, payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  });
  ipcMain.handle(IPC.PLUGIN_LIST, async () => pluginHost.list());
  ipcMain.handle(IPC.PLUGIN_ENABLE, async (_e, id: string) => pluginHost.enable(id));
  ipcMain.handle(IPC.PLUGIN_DISABLE, async (_e, id: string) => pluginHost.disable(id));
  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_e, id: string) => pluginHost.uninstall(id));
  ipcMain.handle(IPC.PLUGIN_GRANT, async (_e, id: string, perms: import('@shared/types/plugin').PluginPermission[]) => {
    pluginHost.grantPermissions(id, perms ?? []);
    return null;
  });
  ipcMain.handle(IPC.PLUGIN_REVOKE, async (_e, id: string) => {
    pluginHost.revokePermissions(id);
    return null;
  });
  ipcMain.handle(IPC.PLUGIN_COMMANDS, async () =>
    [...commandRegistry.entries()].map(([key, c]) => ({
      key,
      pluginId: c.pluginId,
      title: c.title,
      hotkey: c.hotkey
    }))
  );
  ipcMain.handle(IPC.PLUGIN_RUN_COMMAND, async (_e, key: string, ctx: { kbId?: string; notePath?: string }) => {
    const cmd = commandRegistry.get(key);
    if (!cmd) return { ok: false, message: '命令不存在' };
    try {
      await cmd.handler(ctx ?? {});
      return { ok: true, message: '已执行' };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  });
  ipcMain.handle(IPC.PLUGIN_UI_ENTRIES, async () => pluginHost.listUiEntries());
  // 从预置/仓库目录安装社区插件到 userData/plugins/<id>
  ipcMain.handle(IPC.PLUGIN_INSTALL_BUILTIN, async (_e, id: string, sourceDir?: string) =>
    pluginHost.installBuiltin(id, sourceDir)
  );
  ipcMain.handle(IPC.PLUGIN_INSTALL_FILES, async (_e, id: string, files: { path: string; content: string }[]) =>
    pluginHost.installFiles(id, files)
  );
  // 读取插件 UI 源码交给渲染层执行；严格校验路径必须落在插件目录内（防目录穿越）
  ipcMain.handle(IPC.PLUGIN_READ_UI, async (_e, pluginId: string, uiFile: string) => {
    return pluginHost.readUiFile(pluginId, uiFile);
  });
  // 取得插件自带资源的 file:// URL（如 vendor 库），供渲染层动态加载
  ipcMain.handle(IPC.PLUGIN_RESOURCE_URL, async (_e, pluginId: string, relativePath: string) => {
    return pluginHost.getResourceUrl(pluginId, relativePath);
  });
  // 读取插件自带资源文件内容（如 vendor/mermaid.min.js），供渲染层在当前上下文 eval 执行
  ipcMain.handle(IPC.PLUGIN_READ_RESOURCE_FILE, async (_e, pluginId: string, relativePath: string) => {
    return pluginHost.readResourceFile(pluginId, relativePath);
  });

  // 笔记版本历史（doc/笔记版本实现方案.md）
  ipcMain.handle(IPC.VS_LIST, async (_e, kbId: string, notePath: string) =>
    versionService.list(kbId, notePath)
  );
  ipcMain.handle(IPC.VS_SUMMARY, async (_e, kbId: string, notePath: string) =>
    versionService.summary(kbId, notePath)
  );
  ipcMain.handle(IPC.VS_GET, async (_e, kbId: string, notePath: string, versionId: string) =>
    versionService.getContent(kbId, notePath, versionId)
  );
  // a / b 可传 'current' 表示与磁盘当前内容比对
  ipcMain.handle(IPC.VS_DIFF, async (_e, kbId: string, notePath: string, a: string, b: string) =>
    versionService.diff(kbId, notePath, a, b)
  );
  ipcMain.handle(IPC.VS_DIFF_TEXT, async (_e, kbId: string, notePath: string, a: string, b: string) =>
    versionService.diffText(kbId, notePath, a, b)
  );
  ipcMain.handle(IPC.VS_RESTORE, async (_e, kbId: string, notePath: string, versionId: string) =>
    versionService.restore(kbId, notePath, versionId)
  );
  // 手动保存版本：force=true 跳过节流
  ipcMain.handle(IPC.VS_CREATE, async (_e, kbId: string, notePath: string, note?: string) =>
    versionService.create(kbId, notePath, { source: 'manual', note, force: true })
  );
  ipcMain.handle(IPC.VS_DELETE, async (_e, kbId: string, notePath: string, versionId: string) => {
    await versionService.remove(kbId, notePath, versionId);
    return null;
  });
  ipcMain.handle(IPC.VS_PRUNE, async (_e, kbId: string) => versionService.prune(kbId));

  // 知识库巡检（P2-1）：规则类检查不依赖模型，未配置 AI 也能体检
  ipcMain.handle(IPC.AI_PATROL_RUN, async (_e, kbId: string, force?: boolean) => runPatrol(kbId, !!force));
  ipcMain.handle(IPC.AI_PATROL_LATEST, async (_e, kbId: string) => getCachedReport(kbId));
  // 主动建议（P2-5）：取「未在静默期内展示过」的问题，展示后调用 mark 进入 7 天静默
  ipcMain.handle(IPC.AI_PATROL_SUGGEST, async (_e, kbId: string) => getPendingSuggestions(kbId));
  ipcMain.handle(IPC.AI_PATROL_MARK_SHOWN, async (_e, kbId: string, keys: string[]) => {
    markSuggestionsShown(kbId, keys ?? []);
    return null;
  });
  // 阶段 C3：读取 / 保存 Agent 用户覆写（app_config['ai:agents']）；含旧 dailyInsight 迁移
  ipcMain.handle(IPC.AI_AGENT_OVERRIDES, async (_e, overrides?: import('@shared/types/ai').AgentOverridesLike) => {
    if (overrides) {
      agentRegistry.saveOverrides(overrides);
      return null;
    }
    // 迁移：旧 ai:prompts.dailyInsight → ai:agents['daily-muse'].systemPrompt（仅当未设置过）
    const existing = agentRegistry.loadOverrides();
    if (!existing['daily-muse'] && getConfig) {
      const prompts = getConfig<AIPrompts>('ai:prompts', null as any);
      if (prompts?.dailyInsight) {
        existing['daily-muse'] = { systemPrompt: prompts.dailyInsight };
        agentRegistry.saveOverrides(existing);
      }
    }
    return existing;
  });
  // 流式 AI 调用（逐 token 推送，方案 §三.1）：每片通过 AI_STREAM_CHUNK 事件回传 {streamId, delta}
  ipcMain.handle(IPC.AI_HUB_STREAM, async (event, req: import('@shared/types/ai').AIRequest) => {
    const streamId = (req as any).streamId as string | undefined;
    return aiHub.runStream(
      req,
      (delta: string) => {
        if (streamId && event.sender && !event.sender.isDestroyed()) {
          event.sender.send(IPC.AI_STREAM_CHUNK, { streamId, delta });
        }
      },
      (activity) => {
        if (streamId && event.sender && !event.sender.isDestroyed()) {
          event.sender.send(IPC.AI_TOOL_ACTIVITY, { streamId, activity });
        }
      }
    );
  });
  // 成本可观测：用量查询 / 重置（方案 §三.3）
  ipcMain.handle(IPC.AI_GET_USAGE, async () => aiService.getUsage());
  ipcMain.handle(IPC.AI_RESET_USAGE, async () => aiService.resetUsage());
  ipcMain.handle(IPC.AI_INSERT_LINKS, async (_e, kbId: string, p: string, targets: string[]) => {
    await aiService.insertLinks(kbId, p, targets);
    auditService.record(kbId, 'insertLink', { notePath: p, targets });
  });
  ipcMain.handle(IPC.AI_ASK_NOTE, async (_e, kbId: string, p: string, q: string) => aiService.askAboutNote(kbId, p, q));
  ipcMain.handle(IPC.AI_REFINE_NOTE, async (_e, kbId: string, p: string, reply: string, content?: string) =>
    // 阶段 B：用 refiner Agent 人格完善笔记（替代 BASE_SYSTEM 的 refineNote）
    aiService.refineNoteWithAgent(kbId, p, reply, content));

  // Template
  ipcMain.handle(IPC.TPL_LIST, async () => templateService.list());
  ipcMain.handle(IPC.TPL_APPLIED, async (_e, kbId: string) => templateService.loadApplied(kbId));
  ipcMain.handle(IPC.TPL_APPLY, async (_e, kbId: string, templateId: string, selections: string[]) =>
    templateService.apply(kbId, templateId, selections)
  );
  ipcMain.handle(IPC.TPL_EXPORT, async (_e, kbId: string) => {
    const buf = await templateService.export(kbId);
    return buf;
  });
  ipcMain.handle(IPC.TPL_IMPORT, async (_e, kbId: string, data: Uint8Array) => templateService.importTo(kbId, data));
  ipcMain.handle(IPC.TPL_REMOVE, async (_e, kbId: string) => templateService.remove(kbId));
  ipcMain.handle(IPC.TPL_GET_AI_CONFIG, async (_e, kbId: string) => templateService.getAIConfig(kbId));
  ipcMain.handle(IPC.TPL_SAVE_AI_CONFIG, async (_e, kbId: string, c: string) => {
    await templateService.saveAIConfig(kbId, c);
    aiService.invalidateAIConfig(kbId);
  });
  ipcMain.handle(IPC.TPL_GET_DIR_README, async (_e, kbId: string, dirPath: string) => templateService.getDirReadme(kbId, dirPath));
  ipcMain.handle(IPC.TPL_SAVE_DIR_README, async (_e, kbId: string, dirPath: string, c: string) => templateService.saveDirReadme(kbId, dirPath, c));

  // Note templates
  ipcMain.handle(IPC.TPL_GET_NOTE_TEMPLATE, async (_e, kbId: string, dirPath: string) => templateService.getNoteTemplateInfo(kbId, dirPath));
  ipcMain.handle(IPC.TPL_SAVE_NOTE_TEMPLATE, async (_e, kbId: string, dirPath: string, c: string) => templateService.saveNoteTemplate(kbId, dirPath, c));
  ipcMain.handle(IPC.TPL_RESET_NOTE_TEMPLATE, async (_e, kbId: string, dirPath: string) => templateService.resetNoteTemplate(kbId, dirPath));
  ipcMain.handle(IPC.TPL_PREVIEW_NOTE_TEMPLATE, async (_e, kbId: string, dirPath: string, name?: string) => templateService.previewNoteTemplate(kbId, dirPath, name));

  // AI 预设
  ipcMain.handle('ai:listPresets', async (_e, kbId: string) => getAIPresets(kbId));
  ipcMain.handle('ai:savePreset', async (_e, kbId: string, preset: { name: string; content: string; active: boolean }) => {
    saveAIPreset(kbId, preset);
    if (preset.active) setActiveAIPreset(kbId, preset.name);
  });

  // Search
  ipcMain.handle(IPC.SEARCH, async (_e, kbId: string, q: string, opts) => searchService.query(kbId, q, opts));
  ipcMain.handle(IPC.SEARCH_REINDEX, async (_e, kbId: string) => searchService.reindex(kbId));
  // 索引重建（在 Settings 页手动触发）：
  // - rebuildChunks：只刷新 note_chunks（RAG 分段），保留 meta
  // - rebuildMeta：  清掉旧 note_meta 行，重新提取 mtime/size/hash/summary/tags
  // - rebuildTags：  仅重写 note_meta.tags，并清理已删除文件的残留标签行
  ipcMain.handle(IPC.SEARCH_REBUILD_CHUNKS, async (_e, kbId: string) => searchService.rebuildChunks(kbId));
  ipcMain.handle(IPC.SEARCH_REBUILD_META, async (_e, kbId: string) => searchService.rebuildNoteMeta(kbId));
  ipcMain.handle(IPC.SEARCH_REBUILD_TAGS, async (_e, kbId: string) => searchService.rebuildTagIndex(kbId));

  // Audit
  ipcMain.handle(IPC.AUDIT_LIST, async (_e, kbId: string) => auditService.list(kbId));
  ipcMain.handle(IPC.AUDIT_UNDO, async (_e, kbId: string, id: string) => auditService.undo(kbId, id));

  // User Profile（用户画像，doc/用户画像实现方案.md §7.1）
  ipcMain.handle(IPC.PROFILE_GET, async (_e, kbId: string) => profileService.getProfile(kbId));
  ipcMain.handle(IPC.PROFILE_SAVE, async (_e, kbId: string, profile: UserProfile) => profileService.saveProfile(kbId, profile));
  ipcMain.handle(IPC.PROFILE_RESET, async (_e, kbId: string) => profileService.resetProfile(kbId));

  // 事件总线 -> 渲染
  eventBus.on('fsChange', (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.EV_FS_CHANGE, payload);
    }
  });

  // App 更新相关 IPC（统一在 createWindow 前注册，避免渲染进程早于 handler 注册而报 No handler）
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());
  ipcMain.handle(IPC.APP_UPDATE_CHECK, () => {
    checkForUpdates();
    return true;
  });
  ipcMain.handle(IPC.APP_UPDATE_INSTALL, () => {
    downloadAndInstall();
    return true;
  });
  ipcMain.handle(IPC.APP_UPDATE_QUIT_INSTALL, () => {
    quitAndInstall();
    return true;
  });
  ipcMain.handle(IPC.APP_UPDATE_ENABLE_AUTO, (_e, enabled: boolean) => {
    setAutoCheckEnabled(enabled);
    return true;
  });
}
