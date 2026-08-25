// 文件系统服务 - 笔记读写、目录操作、wiki 链接解析
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
import { nanoid } from 'nanoid';
import type { NoteInfo, NoteContent } from '@shared/types';
import { atomicWrite, safeJoin } from '../utils/fs';
import { extractWikiLinks, parseFrontMatter } from '../utils/markdown';
import { getKB } from './store';
import { linkIndex } from './link-index';
import { kbService } from './kb-service';
import { templateService } from './template-service';
import { eventBus } from '../utils/event-bus';

class FSService {
  /**
   * 通过 kbId 获取绝对根目录
   */
  private rootOf(kbId: string): string {
    const kb = getKB(kbId);
    if (!kb) throw new Error(`知识库不存在: ${kbId}`);
    return kb.rootPath;
  }

  /**
   * 安全路径
   */
  private abs(kbId: string, relPath: string): string {
    const root = this.rootOf(kbId);
    return safeJoin(root, relPath);
  }

  /**
   * 读取笔记
   */
  async readNote(kbId: string, notePath: string): Promise<NoteContent> {
    const abs = this.abs(kbId, notePath);
    const stat = await fs.stat(abs);
    const raw = await fs.readFile(abs, 'utf-8');
    const { content, data } = parseFrontMatter(raw);
    const outlinks = extractWikiLinks(content);
    const inlinks = linkIndex.getBacklinks(kbId, notePath);
    const allOut = linkIndex.getAllOutlinks(kbId);
    const existing = new Set(allOut.keys());
    const broken = outlinks.filter((o) => !existing.has(o) && !existing.has(`${o}.md`));
    return {
      path: notePath,
      content,
      frontmatter: data,
      mtime: stat.mtimeMs,
      outlinks,
      inlinks,
      brokenLinks: broken
    };
  }

  /**
   * 写入笔记（原子写）
   */
  async writeNote(kbId: string, notePath: string, content: string): Promise<void> {
    const abs = this.abs(kbId, notePath);
    const old = await this.readNote(kbId, notePath).catch(() => null);
    await atomicWrite(abs, content);
    const newOutlinks = extractWikiLinks(content);
    linkIndex.updateOutlinks(kbId, notePath, newOutlinks);
    // 触发事件
    eventBus.emit('fsChange', { type: 'change', path: notePath });
  }

  /**
   * 新建笔记
   */
  async createNote(kbId: string, dirPath: string, opts?: { useTemplate?: boolean; name?: string }): Promise<NoteInfo> {
    const root = this.rootOf(kbId);
    const name = opts?.name || `未命名笔记-${Date.now()}.md`;
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const dirAbs = dirPath ? safeJoin(root, dirPath) : root;
    await fs.mkdir(dirAbs, { recursive: true });

    // 决定是否使用模板
    let content = `# ${basename(fileName, '.md')}\n\n`;
    if (opts?.useTemplate !== false) {
      // 查找该目录对应的模板
      const dirTemplate = await templateService.getNoteTemplateForDir(kbId, dirPath);
      if (dirTemplate && dirTemplate.trim()) {
        content = templateService.fillTemplateVars(dirTemplate, {
          name: basename(fileName, '.md'),
          kbName: basename(root)
        });
      }
    }

    const filePath = dirPath ? join(dirPath, fileName) : fileName;
    const abs = safeJoin(root, filePath);
    // 避免重名
    let finalPath = filePath;
    let i = 1;
    while (await fs.access(abs).then(() => true).catch(() => false)) {
      const base = basename(fileName, '.md');
      finalPath = dirPath ? join(dirPath, `${base}-${i}.md`) : `${base}-${i}.md`;
      i++;
      break;
    }
    const finalAbs = safeJoin(root, finalPath);
    await atomicWrite(finalAbs, content);
    linkIndex.updateOutlinks(kbId, finalPath, extractWikiLinks(content));
    const stat = await fs.stat(finalAbs);
    const templateDirId = await templateService.findDirIdByPath(kbId, dirPath);
    kbService.invalidateMeta(root);
    return {
      path: finalPath,
      name: basename(finalPath),
      dirPath: dirname(finalPath),
      templateDirId: templateDirId || undefined,
      mtime: stat.mtimeMs,
      size: stat.size
    };
  }

  async deleteNote(kbId: string, notePath: string): Promise<void> {
    const abs = this.abs(kbId, notePath);
    await fs.unlink(abs);
    linkIndex.removeNote(kbId, notePath);
    eventBus.emit('fsChange', { type: 'unlink', path: notePath, isDir: false });
  }

  async moveNote(kbId: string, fromPath: string, toDirPath: string): Promise<string> {
    const root = this.rootOf(kbId);
    const fromAbs = safeJoin(root, fromPath);
    const name = basename(fromPath);
    let toPath = toDirPath ? join(toDirPath, name) : name;
    // 处理重名
    let toAbs = safeJoin(root, toPath);
    let i = 1;
    while (await fs.access(toAbs).then(() => true).catch(() => false)) {
      const base = basename(name, '.md');
      toPath = toDirPath ? join(toDirPath, `${base}-${i}.md`) : `${base}-${i}.md`;
      toAbs = safeJoin(root, toPath);
      i++;
    }
    await fs.mkdir(dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    linkIndex.renameNote(kbId, fromPath, toPath);
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { type: 'change', path: toPath });
    return toPath;
  }

  async renameNote(kbId: string, oldPath: string, newName: string): Promise<string> {
    const root = this.rootOf(kbId);
    const oldAbs = safeJoin(root, oldPath);
    const newFileName = newName.endsWith('.md') ? newName : `${newName}.md`;
    const dir = dirname(oldPath);
    const newPath = dir ? join(dir, newFileName) : newFileName;
    const newAbs = safeJoin(root, newPath);
    await fs.rename(oldAbs, newAbs);
    linkIndex.renameNote(kbId, oldPath, newPath);
    eventBus.emit('fsChange', { type: 'change', path: newPath });
    return newPath;
  }

  async createDir(kbId: string, parentPath: string, name: string): Promise<string> {
    const root = this.rootOf(kbId);
    const parentAbs = parentPath ? safeJoin(root, parentPath) : root;
    const target = join(parentAbs, name);
    await fs.mkdir(target, { recursive: true });
    const newPath = parentPath ? join(parentPath, name) : name;
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { type: 'addDir', path: newPath });
    return newPath;
  }

  async deleteDir(kbId: string, dirPath: string): Promise<void> {
    const root = this.rootOf(kbId);
    const abs = safeJoin(root, dirPath);
    await fs.rm(abs, { recursive: true, force: true });
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { type: 'unlinkDir', path: dirPath });
  }

  async readText(kbId: string, filePath: string): Promise<string> {
    const abs = this.abs(kbId, filePath);
    return await fs.readFile(abs, 'utf-8');
  }

  async writeText(kbId: string, filePath: string, content: string): Promise<void> {
    const abs = this.abs(kbId, filePath);
    await atomicWrite(abs, content);
    eventBus.emit('fsChange', { type: 'change', path: filePath });
  }

  async listTree(kbId: string) {
    const root = this.rootOf(kbId);
    return await kbService.buildTree(root, kbId);
  }
}

export const fsService = new FSService();
