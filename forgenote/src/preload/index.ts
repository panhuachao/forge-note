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
  TagNote
} from '@shared/types';

const api = {
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
    moveNote: (kbId: string, from: string, to: string) => ipcRenderer.invoke(IPC.FS_MOVE_NOTE, kbId, from, to) as Promise<string>,
    renameNote: (kbId: string, old: string, name: string) => ipcRenderer.invoke(IPC.FS_RENAME_NOTE, kbId, old, name) as Promise<string>,
    createDir: (kbId: string, parent: string, name: string) => ipcRenderer.invoke(IPC.FS_CREATE_DIR, kbId, parent, name) as Promise<string>,
    deleteDir: (kbId: string, p: string) => ipcRenderer.invoke(IPC.FS_DELETE_DIR, kbId, p) as Promise<void>,
    renameDir: (kbId: string, dirPath: string, name: string) => ipcRenderer.invoke(IPC.FS_RENAME_DIR, kbId, dirPath, name) as Promise<string>,
    readText: (kbId: string, p: string) => ipcRenderer.invoke(IPC.FS_READ_TEXT, kbId, p) as Promise<string>,
    writeText: (kbId: string, p: string, c: string) => ipcRenderer.invoke(IPC.FS_WRITE_TEXT, kbId, p, c) as Promise<void>,
    listTags: (kbId: string) => ipcRenderer.invoke(IPC.FS_LIST_TAGS, kbId) as Promise<TagInfo[]>,
    notesByTag: (kbId: string, tag: string) => ipcRenderer.invoke(IPC.FS_NOTES_BY_TAG, kbId, tag) as Promise<TagNote[]>
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
      ipcRenderer.invoke(IPC.AI_REFINE_NOTE, kbId, p, reply, content) as Promise<string>
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
    reindex: (kbId: string) => ipcRenderer.invoke(IPC.SEARCH_REINDEX, kbId) as Promise<number>
  },
  audit: {
    list: (kbId: string) => ipcRenderer.invoke(IPC.AUDIT_LIST, kbId) as Promise<AuditEntry[]>,
    undo: (kbId: string, id: string) => ipcRenderer.invoke(IPC.AUDIT_UNDO, kbId, id) as Promise<void>
  },
  win: {
    maximizeToggle: () => ipcRenderer.invoke(IPC.WIN_MAXIMIZE_TOGGLE) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED) as Promise<boolean>,
    minimize: () => ipcRenderer.invoke(IPC.WIN_MINIMIZE) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC.WIN_CLOSE) as Promise<void>
  },
  events: {
    onFsChange: (cb: (e: FSChangeEvent) => void) => {
      const fn = (_: IpcRendererEvent, payload: FSChangeEvent) => cb(payload);
      ipcRenderer.on(IPC.EV_FS_CHANGE, fn);
      return () => ipcRenderer.off(IPC.EV_FS_CHANGE, fn);
    },
    onMenuNewNote: (cb: () => void) => {
      const fn = () => cb();
      ipcRenderer.on('menu:newNote', fn);
      return () => ipcRenderer.off('menu:newNote', fn);
    },
    onMenuAddKb: (cb: () => void) => {
      const fn = () => cb();
      ipcRenderer.on('menu:addKb', fn);
      return () => ipcRenderer.off('menu:addKb', fn);
    }
  }
};

contextBridge.exposeInMainWorld('forge', api);

export type ForgeAPI = typeof api;
