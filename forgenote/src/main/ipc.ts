// IPC 处理器 - 注册所有 ipcMain.handle
import { ipcMain, BrowserWindow, dialog } from 'electron';
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
import { searchService } from './services/search-service';
import { auditService } from './services/audit-service';

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
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
    return getKB(id) || null;
  });
  ipcMain.handle(IPC.KB_SET_ACTIVE, async (_e, id: string) => {
    setConfig('activeKb', id);
  });

  // FS
  ipcMain.handle(IPC.FS_LIST_TREE, async (_e, kbId: string) => fsService.listTree(kbId));
  ipcMain.handle(IPC.FS_READ_NOTE, async (_e, kbId: string, p: string) => fsService.readNote(kbId, p));
  ipcMain.handle(IPC.FS_WRITE_NOTE, async (_e, kbId: string, p: string, c: string) => fsService.writeNote(kbId, p, c));
  ipcMain.handle(IPC.FS_CREATE_NOTE, async (_e, kbId: string, dirPath: string, opts?: { useTemplate?: boolean; name?: string }) => fsService.createNote(kbId, dirPath, opts));
  ipcMain.handle(IPC.FS_DELETE_NOTE, async (_e, kbId: string, p: string) => fsService.deleteNote(kbId, p));
  ipcMain.handle(IPC.FS_MOVE_NOTE, async (_e, kbId: string, from: string, to: string) => fsService.moveNote(kbId, from, to));
  ipcMain.handle(IPC.FS_RENAME_NOTE, async (_e, kbId: string, old: string, name: string) => fsService.renameNote(kbId, old, name));
  ipcMain.handle(IPC.FS_CREATE_DIR, async (_e, kbId: string, parent: string, name: string) => fsService.createDir(kbId, parent, name));
  ipcMain.handle(IPC.FS_DELETE_DIR, async (_e, kbId: string, p: string) => fsService.deleteDir(kbId, p));
  ipcMain.handle(IPC.FS_READ_TEXT, async (_e, kbId: string, p: string) => fsService.readText(kbId, p));
  ipcMain.handle(IPC.FS_WRITE_TEXT, async (_e, kbId: string, p: string, c: string) => fsService.writeText(kbId, p, c));

  // Links
  ipcMain.handle(IPC.LINKS_GET_BACKLINKS, async (_e, kbId: string, p: string) => linkIndex.getBacklinks(kbId, p));
  ipcMain.handle(IPC.LINKS_GET_OUTLINKS, async (_e, kbId: string, p: string) => linkIndex.getOutlinks(kbId, p));
  ipcMain.handle(IPC.LINKS_SUGGEST, async (_e, kbId: string, p: string) => aiService.suggestLinks(kbId, p));

  // AI
  ipcMain.handle(IPC.AI_GET_CONFIG, async () => aiService.getConfig());
  ipcMain.handle(IPC.AI_SET_CONFIG, async (_e, cfg) => aiService.setConfig(cfg));
  ipcMain.handle(IPC.AI_ASK, async (_e, kbId: string, q: string, opts) => aiService.ask(kbId, q, opts));
  ipcMain.handle(IPC.AI_SUMMARIZE, async (_e, kbId: string, p: string) => aiService.summarize(kbId, p));
  ipcMain.handle(IPC.AI_SUGGEST_DIR, async (_e, kbId: string, p: string) => aiService.suggestDir(kbId, p));
  ipcMain.handle(IPC.AI_SUGGEST_LINKS, async (_e, kbId: string, p: string) => aiService.suggestLinks(kbId, p));
  ipcMain.handle(IPC.AI_FORGE_CARD, async (_e, kbId: string, p: string) => aiService.forgeCard(kbId, p));
  ipcMain.handle(IPC.AI_QUICK_NOTE, async (_e, kbId: string, content: string, opts?: { dirId?: string }) =>
    aiService.quickNote(kbId, content, opts)
  );
  ipcMain.handle(IPC.AI_INSERT_LINKS, async (_e, kbId: string, p: string, targets: string[]) => {
    await aiService.insertLinks(kbId, p, targets);
    auditService.record(kbId, 'insertLink', { notePath: p, targets });
  });

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

  // Audit
  ipcMain.handle(IPC.AUDIT_LIST, async (_e, kbId: string) => auditService.list(kbId));
  ipcMain.handle(IPC.AUDIT_UNDO, async (_e, kbId: string, id: string) => auditService.undo(kbId, id));

  // 事件总线 -> 渲染
  eventBus.on('fsChange', (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.EV_FS_CHANGE, payload);
    }
  });
}
