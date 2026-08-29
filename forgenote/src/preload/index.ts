// 预加载脚本 - 通过 contextBridge 暴露类型化 IPC API
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC } from '@shared/ipc-channels';
import type {
  KBSummary,
  KnowledgeBase,
  TreeNode,
  NoteContent,
  NoteInfo,
  LinkInfo,
  AIModelConfig,
  DirSuggestion,
  CardDraft,
  QuickNoteResult,
  AppliedTemplate,
  TemplateMeta,
  AIConfigPreset,
  SearchResult,
  AuditEntry,
  FSChangeEvent,
  NoteTemplateInfo,
  TagInfo,
  TagNote,
  AIRequest,
  AIResponse,
  AIRefHit,
  AIUsage,
  AIPrompts,
  UserProfile
} from '@shared/types';

const api = {
  // 笔记版本历史（doc/笔记版本实现方案.md §7.3）
  version: {
    list: (kbId: string, notePath: string) =>
      ipcRenderer.invoke(IPC.VS_LIST, kbId, notePath) as Promise<import('@shared/types/version').VersionListItem[]>,
    summary: (kbId: string, notePath: string) =>
      ipcRenderer.invoke(IPC.VS_SUMMARY, kbId, notePath) as Promise<import('@shared/types/version').VersionSummary>,
    getContent: (kbId: string, notePath: string, versionId: string) =>
      ipcRenderer.invoke(IPC.VS_GET, kbId, notePath, versionId) as Promise<string | null>,
    /** a / b 可传 'current' 表示与磁盘当前内容比对 */
    diff: (kbId: string, notePath: string, a: string, b: string) =>
      ipcRenderer.invoke(IPC.VS_DIFF, kbId, notePath, a, b) as Promise<import('@shared/types/version').DiffLine[]>,
    diffText: (kbId: string, notePath: string, a: string, b: string) =>
      ipcRenderer.invoke(IPC.VS_DIFF_TEXT, kbId, notePath, a, b) as Promise<string>,
    restore: (kbId: string, notePath: string, versionId: string) =>
      ipcRenderer.invoke(IPC.VS_RESTORE, kbId, notePath, versionId) as Promise<{ ok: boolean; message: string }>,
    create: (kbId: string, notePath: string, note?: string) =>
      ipcRenderer.invoke(IPC.VS_CREATE, kbId, notePath, note) as Promise<string | null>,
    remove: (kbId: string, notePath: string, versionId: string) =>
      ipcRenderer.invoke(IPC.VS_DELETE, kbId, notePath, versionId) as Promise<void>,
    prune: (kbId: string) =>
      ipcRenderer.invoke(IPC.VS_PRUNE, kbId) as Promise<{ removed: number; freedBytes: number }>
  },
  kb: {
    list: () => ipcRenderer.invoke(IPC.KB_LIST) as Promise<KBSummary[]>,
    add: () => ipcRenderer.invoke(IPC.KB_ADD) as Promise<KnowledgeBase | null>,
    remove: (id: string) => ipcRenderer.invoke(IPC.KB_REMOVE, id) as Promise<void>,
    open: (id: string) => ipcRenderer.invoke(IPC.KB_OPEN, id) as Promise<void>,
    getActive: () => ipcRenderer.invoke(IPC.KB_GET_ACTIVE) as Promise<KnowledgeBase | null>,
    setActive: (id: string) => ipcRenderer.invoke(IPC.KB_SET_ACTIVE, id) as Promise<void>
  },
  fs: {
    listTree: (kbId: string) => ipcRenderer.invoke(IPC.FS_LIST_TREE, kbId) as Promise<TreeNode>,
    readNote: (kbId: string, p: string) => ipcRenderer.invoke(IPC.FS_READ_NOTE, kbId, p) as Promise<NoteContent>,
    writeNote: (kbId: string, p: string, c: string) => ipcRenderer.invoke(IPC.FS_WRITE_NOTE, kbId, p, c) as Promise<void>,
    updateTags: (kbId: string, p: string, tags: string[]) =>
      ipcRenderer.invoke(IPC.FS_UPDATE_TAGS, kbId, p, tags) as Promise<void>,
    updateSummary: (kbId: string, p: string, s: string) =>
      ipcRenderer.invoke(IPC.FS_UPDATE_SUMMARY, kbId, p, s) as Promise<void>,
    allTags: (kbId: string) =>
      ipcRenderer.invoke(IPC.FS_ALL_TAGS, kbId) as Promise<{ tag: string; count: number }[]>,
    createNote: (kbId: string, dirPath: string, opts?: { useTemplate?: boolean; name?: string }) =>
      ipcRenderer.invoke(IPC.FS_CREATE_NOTE, kbId, dirPath, opts) as Promise<NoteInfo>,
    deleteNote: (kbId: string, p: string) => ipcRenderer.invoke(IPC.FS_DELETE_NOTE, kbId, p) as Promise<void>,
    moveNote: (kbId: string, from: string, to: string, opts?: { autoCreateDir?: boolean }) =>
      ipcRenderer.invoke(IPC.FS_MOVE_NOTE, kbId, from, to, opts) as Promise<string>,
    renameNote: (kbId: string, old: string, name: string) => ipcRenderer.invoke(IPC.FS_RENAME_NOTE, kbId, old, name) as Promise<string>,
    createDir: (kbId: string, parent: string, name: string) => ipcRenderer.invoke(IPC.FS_CREATE_DIR, kbId, parent, name) as Promise<string>,
    deleteDir: (kbId: string, p: string) => ipcRenderer.invoke(IPC.FS_DELETE_DIR, kbId, p) as Promise<void>,
    renameDir: (kbId: string, dirPath: string, name: string) => ipcRenderer.invoke(IPC.FS_RENAME_DIR, kbId, dirPath, name) as Promise<string>,
    readText: (kbId: string, p: string) => ipcRenderer.invoke(IPC.FS_READ_TEXT, kbId, p) as Promise<string>,
    writeText: (kbId: string, p: string, c: string) => ipcRenderer.invoke(IPC.FS_WRITE_TEXT, kbId, p, c) as Promise<void>,
    listTags: (kbId: string) => ipcRenderer.invoke(IPC.FS_LIST_TAGS, kbId) as Promise<TagInfo[]>,
    notesByTag: (kbId: string, tag: string) => ipcRenderer.invoke(IPC.FS_NOTES_BY_TAG, kbId, tag) as Promise<TagNote[]>
  },
  media: {
    saveImage: (kbId: string, data: Uint8Array, ext: string) =>
      ipcRenderer.invoke(IPC.MEDIA_SAVE_IMAGE, kbId, data, ext) as Promise<string>,
    saveAudio: (kbId: string, data: Uint8Array, ext: string) =>
      ipcRenderer.invoke(IPC.MEDIA_SAVE_AUDIO, kbId, data, ext) as Promise<string>,
    transcribe: (audioAbs: string) => ipcRenderer.invoke(IPC.MEDIA_TRANSCRIBE, audioAbs) as Promise<string>,
    generateTranscriptNote: (kbId: string, audioRelPath: string, text: string) =>
      ipcRenderer.invoke(IPC.MEDIA_GEN_TRANSCRIPT, kbId, audioRelPath, text) as Promise<string>
  },
  links: {
    getBacklinks: (kbId: string, p: string) => ipcRenderer.invoke(IPC.LINKS_GET_BACKLINKS, kbId, p) as Promise<string[]>,
    getOutlinks: (kbId: string, p: string) => ipcRenderer.invoke(IPC.LINKS_GET_OUTLINKS, kbId, p) as Promise<string[]>,
    suggest: (kbId: string, p: string) => ipcRenderer.invoke(IPC.LINKS_SUGGEST, kbId, p) as Promise<LinkInfo[]>
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.APP_VERSION) as Promise<string>,
    checkUpdate: () => ipcRenderer.invoke(IPC.APP_UPDATE_CHECK) as Promise<void>,
    installUpdate: () => ipcRenderer.invoke(IPC.APP_UPDATE_INSTALL) as Promise<void>,
    quitAndInstall: () => ipcRenderer.invoke(IPC.APP_UPDATE_QUIT_INSTALL) as Promise<void>,
    setAutoCheck: (enabled: boolean) => ipcRenderer.invoke(IPC.APP_UPDATE_ENABLE_AUTO, enabled) as Promise<void>,
    onUpdate: (cb: (status: any) => void) => {
      const listener = (_e: IpcRendererEvent, status: any) => cb(status);
      ipcRenderer.on(IPC.EV_APP_UPDATE, listener);
      return () => {
        ipcRenderer.removeListener(IPC.EV_APP_UPDATE, listener);
      };
    }
  },
  ai: {
    getConfig: () => ipcRenderer.invoke(IPC.AI_GET_CONFIG) as Promise<AIModelConfig>,
    setConfig: (cfg: Partial<AIModelConfig>) => ipcRenderer.invoke(IPC.AI_SET_CONFIG, cfg) as Promise<void>,
    getPrompts: () => ipcRenderer.invoke(IPC.AI_GET_PROMPTS) as Promise<AIPrompts>,
    setPrompts: (prompts: AIPrompts) => ipcRenderer.invoke(IPC.AI_SET_PROMPTS, prompts) as Promise<void>,
    ask: (kbId: string, q: string, opts?: { templateDirIds?: string[] }) => ipcRenderer.invoke(IPC.AI_ASK, kbId, q, opts) as Promise<string>,
    summarize: (kbId: string, p: string) => ipcRenderer.invoke(IPC.AI_SUMMARIZE, kbId, p) as Promise<string>,
    generateTags: (kbId: string, p: string) => ipcRenderer.invoke(IPC.AI_GENERATE_TAGS, kbId, p) as Promise<string[]>,
    suggestDir: (kbId: string, p: string) => ipcRenderer.invoke(IPC.AI_SUGGEST_DIR, kbId, p) as Promise<DirSuggestion[]>,
    suggestLinks: (kbId: string, p: string) => ipcRenderer.invoke(IPC.AI_SUGGEST_LINKS, kbId, p) as Promise<LinkInfo[]>,
    forgeCard: (kbId: string, p: string) => ipcRenderer.invoke(IPC.AI_FORGE_CARD, kbId, p) as Promise<CardDraft>,
    quickNote: (kbId: string, content: string, opts?: { dirId?: string }) =>
      ipcRenderer.invoke(IPC.AI_QUICK_NOTE, kbId, content, opts) as Promise<QuickNoteResult>,
    insertLinks: (kbId: string, p: string, targets: string[]) => ipcRenderer.invoke(IPC.AI_INSERT_LINKS, kbId, p, targets) as Promise<void>,
    askAboutNote: (kbId: string, p: string, q: string) => ipcRenderer.invoke(IPC.AI_ASK_NOTE, kbId, p, q) as Promise<string>,
    refineNote: (kbId: string, p: string, reply: string, content?: string) =>
      ipcRenderer.invoke(IPC.AI_REFINE_NOTE, kbId, p, reply, content) as Promise<string>,
    hubRun: (req: AIRequest) => ipcRenderer.invoke(IPC.AI_HUB_RUN, req) as Promise<AIResponse & { sessionId?: string }>,
    // 执行后验证 / 回滚（doc/AI智能管家重构方案.md §6.3 P2-3）
    verifyAction: (action: import('@shared/types/ai').ConfirmableAction, kbId?: string) =>
      ipcRenderer.invoke(IPC.AI_ACTION_VERIFY, action, kbId) as Promise<{ ok: boolean; message: string }>,
    rollbackAction: (action: import('@shared/types/ai').ConfirmableAction, kbId?: string) =>
      ipcRenderer.invoke(IPC.AI_ACTION_ROLLBACK, action, kbId) as Promise<{ ok: boolean; message: string }>,
    // 直接执行一个已注册的确认操作（巡检建议等本地规则生成的 action，无需模型）
    executeAction: (action: import('@shared/types/ai').ConfirmableAction, kbId?: string) =>
      ipcRenderer.invoke(IPC.AI_ACTION_EXECUTE, action, kbId) as Promise<{ ok: boolean; message: string }>,
    // 知识库巡检（P2-1）：规则类检查不依赖模型
    runPatrol: (kbId: string, force?: boolean) =>
      ipcRenderer.invoke(IPC.AI_PATROL_RUN, kbId, force) as Promise<import('@shared/types/ai').PatrolReport>,
    getPatrolReport: (kbId: string) =>
      ipcRenderer.invoke(IPC.AI_PATROL_LATEST, kbId) as Promise<import('@shared/types/ai').PatrolReport | null>,
    // 主动建议与节流（P2-5）
    getPatrolSuggestions: (kbId: string) =>
      ipcRenderer.invoke(IPC.AI_PATROL_SUGGEST, kbId) as Promise<import('@shared/types/ai').PatrolFinding[]>,
    markPatrolShown: (kbId: string, keys: string[]) =>
      ipcRenderer.invoke(IPC.AI_PATROL_MARK_SHOWN, kbId, keys) as Promise<void>,
    // 多 Agent 方案（§3.5）：按 agentId 直接调用专家角色
    runAgent: (kbId: string, agentId: string, text: string, extra?: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC.AI_RUN_AGENT, kbId, agentId, text, extra) as Promise<AIResponse>,
    // 阶段 C3：读取 / 保存 Agent 用户覆写（app_config['ai:agents']）
    getAgentOverrides: () => ipcRenderer.invoke(IPC.AI_AGENT_OVERRIDES) as Promise<import('@shared/types/ai').AgentOverridesLike>,
    setAgentOverrides: (ov: import('@shared/types/ai').AgentOverridesLike) =>
      ipcRenderer.invoke(IPC.AI_AGENT_OVERRIDES, ov) as Promise<void>,
    hubRunStream: (req: AIRequest & { streamId?: string }) =>
      ipcRenderer.invoke(IPC.AI_HUB_STREAM, req) as Promise<AIResponse & { sessionId?: string; refs?: AIRefHit[]; usage?: AIUsage }>,
    onAIStream: (cb: (chunk: { streamId: string; delta: string }) => void) => {
      const listener = (_e: IpcRendererEvent, chunk: { streamId: string; delta: string }) => cb(chunk);
      ipcRenderer.on(IPC.AI_STREAM_CHUNK, listener);
      return () => ipcRenderer.removeListener(IPC.AI_STREAM_CHUNK, listener);
    },
    // 工具调用活动（agent / 时间路由过程中）：主进程回传，渲染层累积为「工具调用气泡」（#4）
    onToolActivity: (cb: (chunk: { streamId: string; activity: { name: string; args: Record<string, unknown>; result: string } }) => void) => {
      const listener = (
        _e: IpcRendererEvent,
        chunk: { streamId: string; activity: { name: string; args: Record<string, unknown>; result: string } }
      ) => cb(chunk);
      ipcRenderer.on(IPC.AI_TOOL_ACTIVITY, listener);
      return () => ipcRenderer.removeListener(IPC.AI_TOOL_ACTIVITY, listener);
    },
    getUsage: () => ipcRenderer.invoke(IPC.AI_GET_USAGE) as Promise<Record<string, { calls: number; tokens: number; ms: number }>>,
    resetUsage: () => ipcRenderer.invoke(IPC.AI_RESET_USAGE) as Promise<void>
  },
  template: {
    list: () => ipcRenderer.invoke(IPC.TPL_LIST) as Promise<TemplateMeta[]>,
    applied: (kbId: string) => ipcRenderer.invoke(IPC.TPL_APPLIED, kbId) as Promise<AppliedTemplate | null>,
    apply: (kbId: string, templateId: string, selections: string[]) =>
      ipcRenderer.invoke(IPC.TPL_APPLY, kbId, templateId, selections) as Promise<AppliedTemplate>,
    export: (kbId: string) => ipcRenderer.invoke(IPC.TPL_EXPORT, kbId) as Promise<Uint8Array>,
    importTo: (kbId: string, data: Uint8Array) => ipcRenderer.invoke(IPC.TPL_IMPORT, kbId, data) as Promise<AppliedTemplate>,
    remove: (kbId: string) => ipcRenderer.invoke(IPC.TPL_REMOVE, kbId) as Promise<void>,
    getAIConfig: (kbId: string) => ipcRenderer.invoke(IPC.TPL_GET_AI_CONFIG, kbId) as Promise<string>,
    saveAIConfig: (kbId: string, c: string) => ipcRenderer.invoke(IPC.TPL_SAVE_AI_CONFIG, kbId, c) as Promise<void>,
    getDirReadme: (kbId: string, dirPath: string) => ipcRenderer.invoke(IPC.TPL_GET_DIR_README, kbId, dirPath) as Promise<string>,
    saveDirReadme: (kbId: string, dirPath: string, c: string) => ipcRenderer.invoke(IPC.TPL_SAVE_DIR_README, kbId, dirPath, c) as Promise<void>,
    getNoteTemplate: (kbId: string, dirPath: string) =>
      ipcRenderer.invoke(IPC.TPL_GET_NOTE_TEMPLATE, kbId, dirPath) as Promise<NoteTemplateInfo | null>,
    saveNoteTemplate: (kbId: string, dirPath: string, content: string) =>
      ipcRenderer.invoke(IPC.TPL_SAVE_NOTE_TEMPLATE, kbId, dirPath, content) as Promise<void>,
    resetNoteTemplate: (kbId: string, dirPath: string) =>
      ipcRenderer.invoke(IPC.TPL_RESET_NOTE_TEMPLATE, kbId, dirPath) as Promise<NoteTemplateInfo | null>,
    previewNoteTemplate: (kbId: string, dirPath: string, name?: string) =>
      ipcRenderer.invoke(IPC.TPL_PREVIEW_NOTE_TEMPLATE, kbId, dirPath, name) as Promise<string>
  },
  aiPresets: {
    list: (kbId: string) => ipcRenderer.invoke('ai:listPresets', kbId) as Promise<AIConfigPreset[]>,
    save: (kbId: string, preset: AIConfigPreset) => ipcRenderer.invoke('ai:savePreset', kbId, preset) as Promise<void>
  },
  search: {
    query: (kbId: string, q: string, opts?: { templateDirIds?: string[]; limit?: number }) =>
      ipcRenderer.invoke(IPC.SEARCH, kbId, q, opts) as Promise<SearchResult[]>,
    reindex: (kbId: string) => ipcRenderer.invoke(IPC.SEARCH_REINDEX, kbId) as Promise<number>,
    rebuildChunks: (kbId: string) => ipcRenderer.invoke(IPC.SEARCH_REBUILD_CHUNKS, kbId) as Promise<number>,
    rebuildMeta: (kbId: string) => ipcRenderer.invoke(IPC.SEARCH_REBUILD_META, kbId) as Promise<number>,
    rebuildTags: (kbId: string) => ipcRenderer.invoke(IPC.SEARCH_REBUILD_TAGS, kbId) as Promise<number>
  },
  audit: {
    list: (kbId: string) => ipcRenderer.invoke(IPC.AUDIT_LIST, kbId) as Promise<AuditEntry[]>,
    undo: (kbId: string, id: string) => ipcRenderer.invoke(IPC.AUDIT_UNDO, kbId, id) as Promise<void>
  },
  profile: {
    get: (kbId: string) => ipcRenderer.invoke(IPC.PROFILE_GET, kbId) as Promise<UserProfile>,
    save: (kbId: string, profile: UserProfile) => ipcRenderer.invoke(IPC.PROFILE_SAVE, kbId, profile) as Promise<UserProfile>,
    reset: (kbId: string) => ipcRenderer.invoke(IPC.PROFILE_RESET, kbId) as Promise<UserProfile>
  },
  win: {
    maximizeToggle: () => ipcRenderer.invoke(IPC.WIN_MAXIMIZE_TOGGLE) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED) as Promise<boolean>,
    minimize: () => ipcRenderer.invoke(IPC.WIN_MINIMIZE) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC.WIN_CLOSE) as Promise<void>
  },
  events: {
    // 确认操作扩展点：主进程请求打开弹窗（doc/MCP技术实现方案.md §8）
    onOpenDialog: (cb: (payload: { dialog: string; params?: Record<string, unknown> }) => void) => {
      const fn = (_e: IpcRendererEvent, payload: { dialog: string; params?: Record<string, unknown> }) => cb(payload);
      ipcRenderer.on(IPC.EV_OPEN_DIALOG, fn);
      return () => ipcRenderer.removeListener(IPC.EV_OPEN_DIALOG, fn);
    },
    onFsChange: (cb: (e: FSChangeEvent) => void) => {
      const fn = (_: IpcRendererEvent, payload: FSChangeEvent) => cb(payload);
      ipcRenderer.on(IPC.EV_FS_CHANGE, fn);
      return () => {
        ipcRenderer.off(IPC.EV_FS_CHANGE, fn);
      };
    },
    onMenuNewNote: (cb: () => void) => {
      const fn = () => cb();
      ipcRenderer.on('menu:newNote', fn);
      return () => {
        ipcRenderer.off('menu:newNote', fn);
      };
    },
    onMenuAddKb: (cb: () => void) => {
      const fn = () => cb();
      ipcRenderer.on('menu:addKb', fn);
      return () => {
        ipcRenderer.off('menu:addKb', fn);
      };
    },
    onMenuAbout: (cb: () => void) => {
      const fn = () => cb();
      ipcRenderer.on('menu:about', fn);
      return () => {
        ipcRenderer.off('menu:about', fn);
      };
    }
  }
};

contextBridge.exposeInMainWorld('forge', api);

export type ForgeAPI = typeof api;
