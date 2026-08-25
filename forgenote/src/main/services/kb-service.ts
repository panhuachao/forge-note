// 知识库服务 - 扫描、构建 Tree、维护模板元数据
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { nanoid } from 'nanoid';
import type { TreeNode, KBSummary } from '@shared/types';
import { isHidden, isMarkdown, ensureDir } from '../utils/fs';
import { getKB, listKBs } from './store';

interface MetaCache {
  templateDirs: Map<string, { name: string; icon: string; color: string; dirName: string }>;
  aiConfigPath?: string;
  rootTemplateJson?: string;
}

class KBService {
  private metaCache = new Map<string, MetaCache>();
  private treeCache = new Map<string, { tree: TreeNode; ts: number }>();

  /**
   * 读取知识库根目录的 .kb_template.json
   */
  async loadTemplateMeta(rootPath: string): Promise<MetaCache> {
    if (this.metaCache.has(rootPath)) return this.metaCache.get(rootPath)!;
    const cache: MetaCache = { templateDirs: new Map() };
    try {
      const metaPath = join(rootPath, '.kb_template.json');
      const raw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw) as { dirs: { id: string; name: string; icon: string; color: string; folderName?: string }[] };
      for (const d of meta.dirs) {
        // 实际目录名通过扫描获得
        cache.templateDirs.set(d.id, { name: d.name, icon: d.icon, color: d.color, dirName: d.folderName || '' });
      }
      cache.rootTemplateJson = metaPath;
    } catch {
      // 无模板
    }
    // 用实际目录扫描匹配
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || isHidden(e.name)) continue;
        const m = /^(\d{2})\s+(.+)$/.exec(e.name);
        if (m) {
          const id = m[1];
          const exist = cache.templateDirs.get(id);
          if (exist) {
            exist.dirName = e.name;
          } else {
            cache.templateDirs.set(id, { name: m[2], icon: '', color: '', dirName: e.name });
          }
        }
      }
    } catch {}
    // AI_CONFIG path
    const aiConfig = join(rootPath, 'AI_CONFIG.md');
    try {
      await fs.access(aiConfig);
      cache.aiConfigPath = aiConfig;
    } catch {}
    this.metaCache.set(rootPath, cache);
    return cache;
  }

  invalidateMeta(rootPath: string) {
    this.metaCache.delete(rootPath);
    this.treeCache.delete(rootPath);
  }

  /**
   * 构建目录树
   */
  async buildTree(rootPath: string, kbId: string): Promise<TreeNode> {
    const cached = this.treeCache.get(rootPath);
    if (cached && Date.now() - cached.ts < 5000) return cached.tree;

    const meta = await this.loadTemplateMeta(rootPath);
    const idToDir = new Map<string, string>(); // dirId -> real folder name
    for (const [id, info] of meta.templateDirs) {
      if (info.dirName) idToDir.set(id, info.dirName);
    }

    const root: TreeNode = {
      id: kbId,
      name: basename(rootPath),
      path: '',
      kind: 'kb_root',
      children: []
    };

    await this.walkDir(rootPath, '', root, idToDir);
    this.countNotes(root);
    this.treeCache.set(rootPath, { tree: root, ts: Date.now() });
    return root;
  }

  private async walkDir(
    abs: string,
    rel: string,
    parent: TreeNode,
    idToDir: Map<string, string>
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    // 排序：目录在前，文件在后，按名称
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    for (const e of entries) {
      if (isHidden(e.name) && e.name !== '.kb_template.json') continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = join(abs, e.name);
      if (e.isDirectory()) {
        const dirNode: TreeNode = {
          id: childRel,
          name: e.name,
          path: childRel,
          kind: 'dir',
          children: []
        };
        // 模板目录
        for (const [id, dirName] of idToDir) {
          if (dirName === e.name) {
            const meta = (await this.loadTemplateMeta(abs)).templateDirs.get(id);
            if (meta) {
              dirNode.templateDirId = id;
              dirNode.templateIcon = meta.icon;
              dirNode.templateColor = meta.color;
              dirNode.name = meta.name ? `${meta.icon} ${e.name.split(' ').slice(1).join(' ') || e.name}` : e.name;
            }
            break;
          }
        }
        parent.children!.push(dirNode);
        await this.walkDir(childAbs, childRel, dirNode, idToDir);
      } else {
        if (!isMarkdown(e.name)) continue;
        const stat = await fs.stat(childAbs);
        parent.children!.push({
          id: childRel,
          name: e.name,
          path: childRel,
          kind: 'file',
          mtime: stat.mtimeMs
        });
      }
    }
  }

  private countNotes(node: TreeNode): number {
    if (node.kind === 'file') return 1;
    if (!node.children) return 0;
    let n = 0;
    for (const c of node.children) n += this.countNotes(c);
    node.noteCount = n;
    return n;
  }

  async getKBSummary(kbId: string): Promise<KBSummary | null> {
    const kb = getKB(kbId);
    if (!kb) return null;
    const tree = await this.buildTree(kb.rootPath, kbId);
    return {
      id: kb.id,
      name: kb.name,
      rootPath: kb.rootPath,
      templateId: kb.templateId,
      noteCount: tree.noteCount || 0
    };
  }

  async listAllSummaries(): Promise<KBSummary[]> {
    const kbs = listKBs();
    const result: KBSummary[] = [];
    for (const kb of kbs) {
      const s = await this.getKBSummary(kb.id);
      if (s) result.push(s);
    }
    return result;
  }
}

export const kbService = new KBService();
