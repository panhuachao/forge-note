// 文件系统服务 - 笔记读写、目录操作、wiki 链接解析
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import { createHash } from 'crypto';
import { type Dirent } from 'fs';
import { join, dirname, basename } from 'path';
import { nanoid } from 'nanoid';
import type { NoteInfo, NoteContent, TagInfo, TagNote } from '@shared/types';
import { atomicWrite, safeJoin } from '../utils/fs';
import { extractWikiLinks, parseFrontMatter, extractTags, writeFrontmatter, readFrontmatter, replaceWikiTarget } from '../utils/markdown';
import { getKB } from './store';
import { linkIndex } from './link-index';
import { versionService } from './version-service';
import matter from 'gray-matter';
import { kbService } from './kb-service';
import { templateService } from './template-service';
import { eventBus } from '../utils/event-bus';
import { searchService } from './search-service';

class FSService {
  // 已迁移 createdAt 的笔记（kbId + notePath），避免 readNote 每次都写盘
  private migratedCtime = new Set<string>();

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
    // 优先使用 FrontMatter.createdAt 作为「创建时间」：
    // atomicWrite 是 writeFile(.tmp) + rename，rename 会替换 inode，
    // 导致 stat.birthtimeMs 变成「最近一次写盘时间」而非真实创建时间。
    // 旧笔记没有 createdAt 时，惰性回填 birthtime 到 frontmatter 并写盘。
    let ctime: number;
    const fmCreatedAt = data['createdAt'];
    if (typeof fmCreatedAt === 'number' && fmCreatedAt > 0) {
      ctime = fmCreatedAt;
    } else {
      ctime = stat.birthtimeMs || stat.ctimeMs;
      const key = `${kbId}::${notePath}`;
      if (!this.migratedCtime.has(key)) {
        this.migratedCtime.add(key);
        try {
          const withCreatedAt = writeFrontmatter(raw, {
            extra: { createdAt: ctime }
          });
          await atomicWrite(abs, withCreatedAt);
          // 回填本次返回的 frontmatter，保持一致
          data['createdAt'] = ctime;
        } catch (e) {
          // 迁移失败不影响本次读取
          this.migratedCtime.delete(key);
        }
      }
    }
    return {
      path: notePath,
      content,
      frontmatter: data,
      mtime: stat.mtimeMs,
      ctime,
      outlinks,
      inlinks,
      brokenLinks: broken
    };
  }

  /**
   * 单通道索引维护（S1 §4）：文件原子写成功后，同步更新链接索引与 RAG 分块索引。
   * 两步均在文件写成功之后执行，保证「文件为真源、索引为派生」的一致性。
   */
  async syncIndex(kbId: string, notePath: string): Promise<void> {
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
   * 正文写盘时，自动保留文件开头已有的 FrontMatter（title/summary/tags 等），
   * 使「摘要、标签」等关键元数据持久化在笔记文件中，
   * 即便更换电脑重新索引，也能从文件头恢复，且支持后续扩展（source 等）。
   */
  async writeNote(kbId: string, notePath: string, content: string): Promise<void> {
    const abs = this.abs(kbId, notePath);
    let raw = content;
    try {
      const existing = await fs.readFile(abs, 'utf-8');
      const oldFm = readFrontmatter(existing);
      // 仅当磁盘上已有 frontmatter 时，将其与新正文合并写回。
      // 这里不能直接调 writeFrontmatter(content, ...)——writeFrontmatter 内部会从
      // 入参 raw 中 parse fm，但入参是新正文（无 fm），将导致 createdAt 等保留字段
      // 被丢失，下次 readNote 回退到 stat.birthtimeMs（rename 后几乎等于 mtime），
      // 表现为「创建时间 == 最后更新」。
      // 因此这里显式按「旧 fm 字段 + 新正文」合并，保留所有原字段（含 createdAt）。
      if (oldFm.data && Object.keys(oldFm.data).length > 0) {
        const next: Record<string, unknown> = { ...oldFm.data };
        if (oldFm.title !== undefined) next['title'] = oldFm.title;
        if (oldFm.summary !== undefined) next['summary'] = oldFm.summary;
        if (oldFm.tags && oldFm.tags.length) next['tags'] = oldFm.tags;
        raw = matter.stringify(content, next);
      }
    } catch {
      // 文件尚不存在等情况：直接写入纯正文
    }
    await atomicWrite(abs, raw);
    const newOutlinks = extractWikiLinks(content);
    linkIndex.updateOutlinks(kbId, notePath, newOutlinks);
    await this.syncIndex(kbId, notePath);
    // 版本历史埋点：仅记录「有变化」，实际快照由调度器节流后异步落盘，
    // 避免 500ms 防抖自动保存把版本区撑爆（doc/笔记版本实现方案.md §4.1）
    versionService.recordChange(kbId, notePath);
    // 触发事件
    eventBus.emit('fsChange', { kbId, type: 'change', path: notePath });
  }

  /**
   * 保存多媒体资源到 KB 根目录统一的 .assets/ 仓库，按类型分子目录，文件名取内容 hash。
   * - 相同二进制内容（hash 一致）永远映射到同一文件，复制粘贴不冗余存储。
   * - 返回相对于仓库根的引用路径（如 .assets/image/a1b2....png），便于 .md 引用与迁移。
   */
  async saveAsset(
    kbId: string,
    kind: 'image' | 'audio',
    data: Uint8Array,
    ext: string
  ): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) throw new Error('KB 不存在: ' + kbId);
    const cleanExt = (ext || 'bin').replace(/^\./, '').toLowerCase();
    // 内容 hash（sha256 截断 32 位），与具体笔记解耦
    const hash = createHash('sha256').update(Buffer.from(data)).digest('hex').slice(0, 32);
    const relDir = `.assets/${kind}`;
    const fileName = `${hash}.${cleanExt}`;
    const absDir = safeJoin(kb.rootPath, relDir);
    const absFile = join(absDir, fileName);
    await fs.mkdir(absDir, { recursive: true });
    // 去重：已存在则直接复用
    if (!fsSync.existsSync(absFile)) {
      await atomicWrite(absFile, Buffer.from(data));
    }
    eventBus.emit('fsChange', { kbId, type: 'change', path: `${relDir}/${fileName}` });
    return `${relDir}/${fileName}`;
  }

  /**
   * 仅更新 frontmatter 中的 tags（去重、过滤空值），保留 body 其它内容不变。
   * 写入后由 readNote 重新计算 outlinks 等元数据，无需重建索引。
   */
  async updateTags(kbId: string, notePath: string, tags: string[]): Promise<void> {
    const abs = this.abs(kbId, notePath);
    const raw = await fs.readFile(abs, 'utf-8');
    const norm = Array.from(
      new Set(
        (tags || [])
          .map((t) => String(t).trim())
          .filter((t) => t.length > 0 && t.length <= 30)
      )
    );
    const yaml = writeFrontmatter(raw, { tags: norm });
    await atomicWrite(abs, yaml);
    await this.syncIndex(kbId, notePath);
    versionService.recordChange(kbId, notePath);
    eventBus.emit('fsChange', { kbId, type: 'change', path: notePath });
  }

  /**
   * 更新 frontmatter 中的 summary 字段，用于「AI 摘要」一键应用。
   */
  async updateSummary(kbId: string, notePath: string, summary: string): Promise<void> {
    const abs = this.abs(kbId, notePath);
    const raw = await fs.readFile(abs, 'utf-8');
    const yaml = writeFrontmatter(raw, { summary: String(summary || '').trim() });
    await atomicWrite(abs, yaml);
    await this.syncIndex(kbId, notePath);
    versionService.recordChange(kbId, notePath);
    eventBus.emit('fsChange', { kbId, type: 'change', path: notePath });
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
    // 避免重名：存在同名则自动追加序号后缀（保持创建流程不被中断）
    let finalPath = filePath;
    let i = 1;
    while (await fs.access(abs).then(() => true).catch(() => false)) {
      const base = basename(fileName, '.md');
      finalPath = dirPath ? join(dirPath, `${base}-${i}.md`) : `${base}-${i}.md`;
      i++;
    }
    const finalAbs = safeJoin(root, finalPath);
    // 写入标准 FrontMatter 头（title/summary/tags），使关键元数据持久化于文件开头，
    // 便于跨设备重新索引、查看摘要与标签，并支持后续扩展（source 等）。
    const title = basename(fileName, '.md');
    // 在 FrontMatter 中固化 createdAt，避免 atomicWrite 替换 inode 后 stat.birthtimeMs
    // 变成「最近一次写盘时间」而失去真实创建时间。
    const withFm = writeFrontmatter(content, {
      title,
      summary: '',
      tags: [],
      extra: { createdAt: Date.now() }
    });
    await atomicWrite(finalAbs, withFm);
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
    // 版本数据转入 orphan 区保留 30 天，误删后仍可找回（doc/笔记版本实现方案.md §4.5）
    void versionService.onNoteDeleted(kbId, notePath);
    // 清除 buildTree 的 5 秒缓存，避免 listTree 返回旧树导致删除"看似不生效"
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { kbId, type: 'unlink', path: notePath, isDir: false });
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
    // 移动前先存一个版本（路径变更属高风险操作，便于误移后找回）
    void versionService.create(kbId, fromPath, { source: 'pre-move', force: true });
    await fs.rename(fromAbs, toAbs);
    linkIndex.renameNote(kbId, fromPath, toPath);
    await searchService.removeNote(kbId, fromPath);
    await this.syncIndex(kbId, toPath);
    // 版本数据的 noteId 基于首次路径哈希，终身不变，此处只需更新路径映射
    void versionService.onNoteMoved(kbId, fromPath, toPath);
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { kbId, type: 'change', path: toPath });
    return toPath;
  }

  async renameNote(kbId: string, oldPath: string, newName: string): Promise<string> {
    const root = this.rootOf(kbId);
    const oldAbs = safeJoin(root, oldPath);
    const newFileName = newName.endsWith('.md') ? newName : `${newName}.md`;
    const dir = dirname(oldPath);
    const newPath = dir ? join(dir, newFileName) : newFileName;
    const newAbs = safeJoin(root, newPath);

    const oldBase = basename(oldPath, '.md');
    const newBase = basename(newPath, '.md');

    // 1) 唯一性校验：双链 [[笔记名]] 基于 basename 命名空间，重名会导致链接歧义，
    //    因此要求新名称在当前知识库内唯一（排除自身）。
    if (newBase !== oldBase) {
      const conflict = this.findNoteByBaseName(kbId, newBase, oldPath);
      if (conflict) {
        throw new Error(`笔记名「${newBase}」已存在，为保证双链唯一性请使用其他名称`);
      }
    }

    // 重命名前存一个版本（路径变更属高风险操作）
    void versionService.create(kbId, oldPath, { source: 'pre-move', force: true });
    await fs.rename(oldAbs, newAbs);
    linkIndex.renameNote(kbId, oldPath, newPath);
    await searchService.removeNote(kbId, oldPath);
    await this.syncIndex(kbId, newPath);
    // 版本数据跟随新路径（noteId 不变，仅更新映射）
    void versionService.onNoteMoved(kbId, oldPath, newPath);
    // 清除 buildTree 的 5 秒缓存，让重命名后的最新树被下次 listTree 拿到
    kbService.invalidateMeta(root);

    // 2) 双链同步：其它笔记通过 [[旧名]] 引用了本笔记时，改名后需同步更新引用，
    //    否则旧链接失效（resolve 不到新路径）。
    if (newBase !== oldBase) {
      await this.syncWikiRename(kbId, oldBase, newBase);
    }

    eventBus.emit('fsChange', { kbId, type: 'change', path: newPath });
    return newPath;
  }

  /**
   * 在整个知识库内查找 basename（去 .md）等于 baseName 的笔记路径，
   * 排除 excludePath 自身。用于重命名唯一性校验。
   */
  private findNoteByBaseName(kbId: string, baseName: string, excludePath?: string): string | undefined {
    for (const p of linkIndex.getAllNotePaths(kbId)) {
      if (p === excludePath) continue;
      if (basename(p, '.md') === baseName) return p;
    }
    return undefined;
  }

  /**
   * 把所有引用了 oldName（basename）的笔记中的 [[oldName]] 同步替换为 [[newName]]，
   * 保留别名（如 [[newName|别名]]）。更新索引并触发 fsChange 事件。
   */
  private async syncWikiRename(kbId: string, oldName: string, newName: string): Promise<void> {
    const refs = linkIndex.getBacklinks(kbId, oldName);
    for (const refPath of refs) {
      try {
        const abs = this.abs(kbId, refPath);
        const raw = await fs.readFile(abs, 'utf-8');
        const updated = replaceWikiTarget(raw, oldName, newName);
        if (updated === raw) continue;
        // 直接写盘（保留 frontmatter），并刷新双链索引与搜索索引
        await atomicWrite(abs, updated);
        linkIndex.updateOutlinks(kbId, refPath, extractWikiLinks(updated));
        await this.syncIndex(kbId, refPath);
        eventBus.emit('fsChange', { kbId, type: 'change', path: refPath });
      } catch {
        // 单个引用笔记更新失败不影响其余引用
      }
    }
  }

  async createDir(kbId: string, parentPath: string, name: string): Promise<string> {
    const root = this.rootOf(kbId);
    const parentAbs = parentPath ? safeJoin(root, parentPath) : root;
    const target = join(parentAbs, name);
    await fs.mkdir(target, { recursive: true });
    const newPath = parentPath ? join(parentPath, name) : name;
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { kbId, type: 'addDir', path: newPath });
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
      // 递归删除时逐篇把版本数据转入 orphan 区
      void versionService.onNoteDeleted(kbId, notePath);
    }
    await fs.rm(abs, { recursive: true, force: true });
    kbService.invalidateMeta(root);
    eventBus.emit('fsChange', { kbId, type: 'unlinkDir', path: dirPath });
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
    eventBus.emit('fsChange', { kbId, type: 'renameDir', path: dirPath, to: newPath });
    return newPath;
  }

  async readText(kbId: string, filePath: string): Promise<string> {
    const abs = this.abs(kbId, filePath);
    return await fs.readFile(abs, 'utf-8');
  }

  async writeText(kbId: string, filePath: string, content: string): Promise<void> {
    const abs = this.abs(kbId, filePath);
    await atomicWrite(abs, content);
    // AI Patch / 批量修改走此路径（note-patch 会自行 syncIndex）
    versionService.recordChange(kbId, filePath);
    eventBus.emit('fsChange', { kbId, type: 'change', path: filePath });
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
