// IPC 通道名称常量 - 主进程与渲染进程共用
export const IPC = {
  // KB
  KB_LIST: 'kb:list',
  KB_ADD: 'kb:add',
  KB_REMOVE: 'kb:remove',
  KB_OPEN: 'kb:open',
  KB_GET_ACTIVE: 'kb:getActive',
  KB_SET_ACTIVE: 'kb:setActive',

  // FS
  FS_LIST_TREE: 'fs:listTree',
  FS_READ_NOTE: 'fs:readNote',
  FS_WRITE_NOTE: 'fs:writeNote',
  FS_UPDATE_TAGS: 'fs:updateTags',
  FS_UPDATE_SUMMARY: 'fs:updateSummary',
  FS_ALL_TAGS: 'fs:allTags',
  FS_CREATE_NOTE: 'fs:createNote',
  FS_DELETE_NOTE: 'fs:deleteNote',
  FS_MOVE_NOTE: 'fs:moveNote',
  FS_RENAME_NOTE: 'fs:renameNote',
  FS_CREATE_DIR: 'fs:createDir',
  FS_DELETE_DIR: 'fs:deleteDir',
  FS_RENAME_DIR: 'fs:renameDir',
  FS_READ_TEXT: 'fs:readText',
  FS_WRITE_TEXT: 'fs:writeText',
  FS_LIST_TAGS: 'fs:listTags',
  FS_NOTES_BY_TAG: 'fs:notesByTag',

  // Links
  LINKS_GET_BACKLINKS: 'links:getBacklinks',
  LINKS_GET_OUTLINKS: 'links:getOutlinks',
  LINKS_SUGGEST: 'links:suggest',

  // AI
  AI_GET_CONFIG: 'ai:getConfig',
  AI_SET_CONFIG: 'ai:setConfig',
  AI_GET_PROMPTS: 'ai:getPrompts',
  AI_SET_PROMPTS: 'ai:setPrompts',
  AI_ASK: 'ai:ask',
  AI_SUMMARIZE: 'ai:summarize',
  AI_GENERATE_TAGS: 'ai:generateTags',
  AI_SUGGEST_DIR: 'ai:suggestDir',
  AI_SUGGEST_LINKS: 'ai:suggestLinks',
  AI_FORGE_CARD: 'ai:forgeCard',
  AI_INSERT_LINKS: 'ai:insertLinks',
  AI_ASK_NOTE: 'ai:askNote',
  AI_REFINE_NOTE: 'ai:refineNote',
  AI_QUICK_NOTE: 'ai:quickNote',
  AI_HUB_RUN: 'ai:hubRun',
  AI_HUB_STREAM: 'ai:hubStream',
  AI_RUN_AGENT: 'ai:runAgent',
  AI_AGENT_OVERRIDES: 'ai:agentOverrides',
  AI_STREAM_CHUNK: 'ai:streamChunk',
  AI_TOOL_ACTIVITY: 'ai:toolActivity',
  AI_GET_USAGE: 'ai:getUsage',
  AI_RESET_USAGE: 'ai:resetUsage',

  // Media（多媒体：图片/音频资源统一存于 KB 根 .assets/，按内容 hash 去重）
  MEDIA_SAVE_IMAGE: 'media:saveImage',
  MEDIA_SAVE_AUDIO: 'media:saveAudio',
  MEDIA_TRANSCRIBE: 'media:transcribe',
  MEDIA_GEN_TRANSCRIPT: 'media:genTranscript',

  // Template
  TPL_LIST: 'tpl:list',
  TPL_APPLIED: 'tpl:applied',
  TPL_APPLY: 'tpl:apply',
  TPL_EXPORT: 'tpl:export',
  TPL_IMPORT: 'tpl:import',
  TPL_REMOVE: 'tpl:remove',
  TPL_GET_AI_CONFIG: 'tpl:getAIConfig',
  TPL_SAVE_AI_CONFIG: 'tpl:saveAIConfig',
  TPL_GET_DIR_README: 'tpl:getDirReadme',
  TPL_SAVE_DIR_README: 'tpl:saveDirReadme',

  // Search
  SEARCH: 'search:query',
  SEARCH_REINDEX: 'search:reindex',
  SEARCH_REBUILD_CHUNKS: 'search:rebuildChunks',
  SEARCH_REBUILD_META: 'search:rebuildMeta',
  SEARCH_REBUILD_TAGS: 'search:rebuildTags',

  // Note templates
  TPL_GET_NOTE_TEMPLATE: 'tpl:getNoteTemplate',
  TPL_SAVE_NOTE_TEMPLATE: 'tpl:saveNoteTemplate',
  TPL_RESET_NOTE_TEMPLATE: 'tpl:resetNoteTemplate',
  TPL_PREVIEW_NOTE_TEMPLATE: 'tpl:previewNoteTemplate',

  // Audit
  AUDIT_LIST: 'audit:list',
  AUDIT_UNDO: 'audit:undo',

  // Push events (主 -> 渲染)
  EV_FS_CHANGE: 'ev:fsChange',
  EV_TPL_CHANGE: 'ev:tplChange',
  EV_TOAST: 'ev:toast',
  EV_THEME: 'ev:theme',
  // 确认操作扩展点：主进程请求渲染层打开某个弹窗（doc/MCP技术实现方案.md §8）
  EV_OPEN_DIALOG: 'ev:openDialog',

  // Window control
  WIN_MAXIMIZE_TOGGLE: 'win:maximizeToggle',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  WIN_MINIMIZE: 'win:minimize',
  WIN_CLOSE: 'win:close',

  // App update
  APP_VERSION: 'app:version',
  APP_UPDATE_CHECK: 'app:updateCheck',
  APP_UPDATE_INSTALL: 'app:updateInstall',
  APP_UPDATE_QUIT_INSTALL: 'app:updateQuitInstall',
  APP_UPDATE_ENABLE_AUTO: 'app:updateEnableAuto',
  EV_APP_UPDATE: 'ev:appUpdate',

  // User Profile（用户画像，doc/用户画像实现方案.md）
  PROFILE_GET: 'profile:get',
  PROFILE_SAVE: 'profile:save',
  PROFILE_RESET: 'profile:reset'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// 自动更新状态（主进程 -> 渲染进程）
export type UpdateStatus =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes?: string }
  | { type: 'not-available'; version: string }
  | { type: 'progress'; percent: number; transferred: number; total: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

