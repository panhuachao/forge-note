// 文件系统服务 - 笔记读写、目录操作、wiki 链接解析
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
import { nanoid } from 'nanoid';
import type { NoteInfo, NoteContent, TagInfo, TagNote } from '@shared/types';
import { atomicWrite, safeJoin } from '../utils/fs';
import { extractWikiLinks, parseFrontMatter, extractTags } from '../utils/markdown';
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
      ctime: stat.birthtimeMs || stat.ctimeMs,
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
    const root = this.rootOf(kbId);
    const abs = this.abs(kbId, notePath);
    await fs.unlink(abs);
    linkIndex.removeNote(kbId, notePath);
    // 清除 buildTree 的 5 秒缓存，避免 listTree 返回旧树导致删除"看似不生效"
    kbService.invalidateMeta(root);
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
    // 清除 buildTree 的 5 秒缓存，让重命名后的最新树被下次 listTree 拿到
    kbService.invalidateMeta(root);
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
    // 递归收集该目录下所有笔记，先清理双链索引（避免已删除笔记残留在索引中）
    const collected: string[] = [];
    const walk = (p: string, rel: string) => {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const e of entries) {
        const full = join(p, e.name);
        const relPath = rel ? join(rel, e.name) : e.name;
        if (e.isDirectory()) {
          walk(full, relPath);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md') && !e.name.startsWith('.')) {
          collected.push(relPath);
        }
      }
    };
    try {
      walk(abs, dirPath);
    } catch {
      // 目录不存在等忽略
    }
    for (const notePath of collected) {
      linkIndex.removeNote(kbId, notePath);
    }
    await fs.rm(abs, { recursive: true, force: true });
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { type: 'unlinkDir', path: dirPath });
  }

  async renameDir(kbId: string, dirPath: string, newName: string): Promise<string> {
    const root = this.rootOf(kbId);
    const abs = safeJoin(root, dirPath);
    const parent = dirname(abs);
    const newAbs = join(parent, newName);
    if (abs !== newAbs) {
      await fs.mkdir(parent, { recursive: true });
      await fs.rename(abs, newAbs);
    }
    const newPath = dirPath.includes('/')
      ? dirPath.slice(0, dirPath.lastIndexOf('/')) + '/' + newName
      : newName;
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { type: 'renameDir', path: dirPath, to: newPath });
    return newPath;
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

  /**
   * 列出知识库内全部标签及其命中笔记数（按数量降序）
   */
  async listTags(kbId: string): Promise<TagInfo[]> {
    const root = this.rootOf(kbId);
    const counter = new Map<string, number>();
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          try {
            const raw = await fs.readFile(full, 'utf-8');
            for (const t of extractTags(raw)) {
              counter.set(t, (counter.get(t) || 0) + 1);
            }
          } catch {
            // 读取失败跳过
          }
        }
      }
    };
    await walk(root);
    return [...counter.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /**
   * 返回带有指定标签的全部笔记（含一级目录分组信息）
   */
  async notesByTag(kbId: string, tag: string): Promise<TagNote[]> {
    const root = this.rootOf(kbId);
    const rootName = basename(root);
    const result: TagNote[] = [];
    const target = tag.trim();
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          try {
            const raw = await fs.readFile(full, 'utf-8');
            if (!extractTags(raw).includes(target)) continue;
            const rel = root ? full.slice(root.length + 1) : e.name;
            const parts = rel.split('/');
            const topDir = parts.length > 1 ? parts[0] : '';
            const stat = await fs.stat(full);
            result.push({
              path: rel,
              name: e.name,
              dirPath: dirname(rel),
              topDir,
              topDirName: topDir ? topDir : rootName,
              mtime: stat.mtimeMs,
              size: stat.size
            });
          } catch {
            // 读取失败跳过
          }
        }
      }
    };
    await walk(root);
    return result.sort((a, b) => b.mtime - a.mtime);
  }
}

export const fsService = new FSService();
