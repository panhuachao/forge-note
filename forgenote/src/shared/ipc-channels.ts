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
  FS_CREATE_NOTE: 'fs:createNote',
  FS_DELETE_NOTE: 'fs:deleteNote',
  FS_MOVE_NOTE: 'fs:moveNote',
  FS_RENAME_NOTE: 'fs:renameNote',
  FS_CREATE_DIR: 'fs:createDir',
  FS_DELETE_DIR: 'fs:deleteDir',
  FS_READ_TEXT: 'fs:readText',
  FS_WRITE_TEXT: 'fs:writeText',

  // Links
  LINKS_GET_BACKLINKS: 'links:getBacklinks',
  LINKS_GET_OUTLINKS: 'links:getOutlinks',
  LINKS_SUGGEST: 'links:suggest',

  // AI
  AI_GET_CONFIG: 'ai:getConfig',
  AI_SET_CONFIG: 'ai:setConfig',
  AI_ASK: 'ai:ask',
  AI_SUMMARIZE: 'ai:summarize',
  AI_SUGGEST_DIR: 'ai:suggestDir',
  AI_SUGGEST_LINKS: 'ai:suggestLinks',
  AI_FORGE_CARD: 'ai:forgeCard',
  AI_INSERT_LINKS: 'ai:insertLinks',
  AI_QUICK_NOTE: 'ai:quickNote',

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
  EV_THEME: 'ev:theme'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
