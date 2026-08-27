// 文件系统服务 - 笔记读写、目录操作、wiki 链接解析
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import { type Dirent } from 'fs';
import { join, dirname, basename } from 'path';
import { nanoid } from 'nanoid';
import type { NoteInfo, NoteContent, TagInfo, TagNote } from '@shared/types';
import { atomicWrite, safeJoin } from '../utils/fs';
import { extractWikiLinks, parseFrontMatter, extractTags } from '../utils/markdown';
import { getKB } from './store';
import { linkIndex } from './link-index';
import matter from 'gray-matter';
import { kbService } from './kb-service';
import { templateService } from './template-service';
import { eventBus } from '../utils/event-bus';
import { searchService } from './search-service';

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
    // 失效链接：outlinks 是 wiki target 集合（如 [[笔记名]] 中的「笔记名」），
    // 需通过 linkIndex.resolve(target) 判定是否可解析到真实 notePath，
    // 不能直接用 notePath 集合去比对 target，否则所有出链都会被误判为失效
    const broken = outlinks.filter((o) => !linkIndex.resolve(kbId, o));
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
   * 单通道索引维护（S1 §4）：文件原子写成功后，同步更新链接索引与 RAG 分块索引。
   * 两步均在文件写成功之后执行，保证「文件为真源、索引为派生」的一致性。
   */
  private async syncIndex(kbId: string, notePath: string): Promise<void> {
    const abs = this.abs(kbId, notePath);
    try {
      const raw = await fs.readFile(abs, 'utf-8');
      const stat = await fs.stat(abs);
      const newOutlinks = extractWikiLinks(raw);
      linkIndex.updateOutlinks(kbId, notePath, newOutlinks);
      await searchService.upsertNote(kbId, notePath, raw, stat.mtimeMs, stat.size);
    } catch {
      // 索引维护失败不阻断主流程（下次重扫可自愈）
    }
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
    await this.syncIndex(kbId, notePath);
    // 触发事件
    eventBus.emit('fsChange', { type: 'change', path: notePath });
  }

  /**
   * 仅更新 frontmatter 中的 tags（去重、过滤空值），保留 body 其它内容不变。
   * 写入后由 readNote 重新计算 outlinks 等元数据，无需重建索引。
   */
  async updateTags(kbId: string, notePath: string, tags: string[]): Promise<void> {
    const abs = this.abs(kbId, notePath);
    const raw = await fs.readFile(abs, 'utf-8');
    const { content, data } = parseFrontMatter(raw);
    const norm = Array.from(
      new Set(
        (tags || [])
          .map((t) => String(t).trim())
          .filter((t) => t.length > 0 && t.length <= 30)
      )
    );
    const nextData = { ...(data || {}), tags: norm };
    const yaml = matter.stringify(content, nextData);
    await atomicWrite(abs, yaml);
    await this.syncIndex(kbId, notePath);
    eventBus.emit('fsChange', { type: 'change', path: notePath });
  }

  /**
   * 更新 frontmatter 中的 summary 字段，用于「AI 摘要」一键应用。
   */
  async updateSummary(kbId: string, notePath: string, summary: string): Promise<void> {
    const abs = this.abs(kbId, notePath);
    const raw = await fs.readFile(abs, 'utf-8');
    const { content, data } = parseFrontMatter(raw);
    const nextData = { ...(data || {}), summary: String(summary || '').trim() };
    const yaml = matter.stringify(content, nextData);
    await atomicWrite(abs, yaml);
    await this.syncIndex(kbId, notePath);
    eventBus.emit('fsChange', { type: 'change', path: notePath });
  }

  /**
   * 收集知识库中所有笔记的 frontmatter tags（含未被任何笔记引用的「孤立」标签），
   * 返回 { tag -> 计数 }。供属性面板「选择已有标签」下拉使用。
   */
  async getAllTags(kbId: string): Promise<{ tag: string; count: number }[]> {
    const root = this.rootOf(kbId);
    if (!root) return [];
    const counter = new Map<string, number>();
    const walk = async (dir: string) => {
      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          try {
            const raw = await fs.readFile(full, 'utf-8');
            const { data } = parseFrontMatter(raw);
            const list = Array.isArray((data as any)?.tags) ? (data as any).tags : [];
            for (const t of list) {
              const s = String(t).trim();
              if (s) counter.set(s, (counter.get(s) || 0) + 1);
            }
          } catch {}
        }
      }
    };
    await walk(root);
    return Array.from(counter.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
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
    await searchService.removeNote(kbId, notePath);
    // 清除 buildTree 的 5 秒缓存，避免 listTree 返回旧树导致删除"看似不生效"
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { type: 'unlink', path: notePath, isDir: false });
  }

  async moveNote(kbId: string, fromPath: string, toDirPath: string, opts?: { autoCreateDir?: boolean }): Promise<string> {
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
    if (opts?.autoCreateDir) {
      await fs.mkdir(dirname(toAbs), { recursive: true });
    }
    await fs.rename(fromAbs, toAbs);
    linkIndex.renameNote(kbId, fromPath, toPath);
    await searchService.removeNote(kbId, fromPath);
    await this.syncIndex(kbId, toPath);
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
    await searchService.removeNote(kbId, oldPath);
    await this.syncIndex(kbId, newPath);
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
      const entries = fsSync.readdirSync(p, { withFileTypes: true });
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
      await searchService.removeNote(kbId, notePath);
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
