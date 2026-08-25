// 模板服务 - 解析、加载、应用、导入/导出
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { nanoid } from 'nanoid';
import { app } from 'electron';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { AppliedTemplate, TemplateMeta, TemplateDir, NoteTemplateInfo } from '@shared/types';
import { atomicWrite, ensureDir, safeJoin, copyDir } from '../utils/fs';
import { getKB, updateKBTemplate, addAudit } from './store';
import { kbService } from './kb-service';

// 内置模板路径
function builtinTemplatePath(): string {
  // electron-vite 打包后 resources 在 process.resourcesPath
  // 开发期 __dirname = <root>/dist/main，向上两级到 <root>，再进 resources
  if (app.isPackaged) {
    return join(process.resourcesPath, 'templates', 'para-plus');
  }
  return join(__dirname, '..', '..', 'resources', 'templates', 'para-plus');
}

class TemplateService {
  private builtinCache: TemplateMeta | null = null;

  /**
   * 列出可用模板
   */
  async list(): Promise<TemplateMeta[]> {
    const tmpl = await this.loadBuiltin();
    return [tmpl];
  }

  /**
   * 加载内置模板
   */
  async loadBuiltin(): Promise<TemplateMeta> {
    if (this.builtinCache) return this.builtinCache;
    const root = builtinTemplatePath();
    const metaRaw = await fs.readFile(join(root, '.kb_template.json'), 'utf-8');
    const meta = JSON.parse(metaRaw) as TemplateMeta;
    // 注入 .kb_template.json 所在目录的相对路径
    meta.aiConfig = 'AI_CONFIG.md';
    for (const d of meta.dirs) {
      d.readme = `${d.id === '' ? '' : this.findDirNameById(meta, d.id) + '/'}README.md`;
      d.noteTemplate = `${d.id === '' ? '' : this.findDirNameById(meta, d.id) + '/'}.template.md`;
    }
    this.builtinCache = meta;
    return meta;
  }

  private findDirNameById(meta: TemplateMeta, id: string): string {
    // 约定：dirs 顺序与 00 01 02... 对应；真实目录名 = `${id} ${name}`
    const d = meta.dirs.find((x) => x.id === id);
    if (!d) return id;
    return `${d.id} ${d.name}`;
  }

  /**
   * 加载已应用的模板（从知识库根目录读取）
   */
  async loadApplied(kbId: string): Promise<AppliedTemplate | null> {
    const kb = getKB(kbId);
    if (!kb) return null;
    const metaPath = join(kb.rootPath, '.kb_template.json');
    try {
      const metaRaw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw) as TemplateMeta;
      const aiConfigContent = await fs.readFile(join(kb.rootPath, 'AI_CONFIG.md'), 'utf-8').catch(() => '');
      const dirReadmes: Record<string, string> = {};
      const dirNoteTemplates: Record<string, string> = {};
      for (const d of meta.dirs) {
        const realDir = `${d.id} ${d.name}`;
        try {
          dirReadmes[d.id] = await fs.readFile(join(kb.rootPath, realDir, 'README.md'), 'utf-8');
        } catch {}
        try {
          dirNoteTemplates[d.id] = await fs.readFile(join(kb.rootPath, realDir, '.template.md'), 'utf-8');
        } catch {}
      }
      return {
        meta,
        rootPath: kb.rootPath,
        aiConfigContent,
        dirReadmes,
        dirNoteTemplates,
        appliedAt: kb.createdAt
      };
    } catch {
      return null;
    }
  }

  /**
   * 应用模板到知识库
   */
  async apply(kbId: string, templateId: string, selections: string[]): Promise<AppliedTemplate> {
    const kb = getKB(kbId);
    if (!kb) throw new Error('知识库不存在');
    const tmpl = await this.loadBuiltin();
    if (tmpl.templateId !== templateId) throw new Error('不支持的模板');

    // 复制选中的目录
    const srcRoot = builtinTemplatePath();
    const dstRoot = kb.rootPath;
    await ensureDir(dstRoot);
    for (const d of tmpl.dirs) {
      if (!selections.includes(d.id)) continue;
      const dirName = `${d.id} ${d.name}`;
      const srcDir = join(srcRoot, dirName);
      const dstDir = join(dstRoot, dirName);
      // 已存在则跳过（不覆盖用户已有内容）
      const exists = await fs.access(dstDir).then(() => true).catch(() => false);
      if (exists) continue;
      await copyDir(srcDir, dstDir);
    }
    // 复制 AI_CONFIG.md
    const aiSrc = join(srcRoot, 'AI_CONFIG.md');
    const aiDst = join(dstRoot, 'AI_CONFIG.md');
    if (!(await fs.access(aiDst).then(() => true).catch(() => false))) {
      await fs.copyFile(aiSrc, aiDst);
    }
    // 复制 .kb_template.json
    const metaSrc = join(srcRoot, '.kb_template.json');
    const metaDst = join(dstRoot, '.kb_template.json');
    if (!(await fs.access(metaDst).then(() => true).catch(() => false))) {
      await fs.copyFile(metaSrc, metaDst);
    }

    updateKBTemplate(kbId, templateId);
    addAudit(
      {
        id: nanoid(),
        ts: Date.now(),
        action: 'applyTemplate',
        payload: { kbId, templateId, selections }
      },
      kbId
    );
    kbService.invalidateMeta(dstRoot);
    return (await this.loadApplied(kbId))!;
  }

  async remove(kbId: string): Promise<void> {
    const kb = getKB(kbId);
    if (!kb) return;
    const metaPath = join(kb.rootPath, '.kb_template.json');
    await fs.unlink(metaPath).catch(() => {});
    const aiPath = join(kb.rootPath, 'AI_CONFIG.md');
    await fs.unlink(aiPath).catch(() => {});
    updateKBTemplate(kbId, null);
    kbService.invalidateMeta(kb.rootPath);
    addAudit(
      { id: nanoid(), ts: Date.now(), action: 'removeTemplate', payload: { kbId } },
      kbId
    );
  }

  /**
   * 导出模板为 .kbtemplate (zip)
   */
  async export(kbId: string): Promise<Uint8Array> {
    const applied = await this.loadApplied(kbId);
    if (!applied) throw new Error('该知识库未应用模板');
    const files: Record<string, Uint8Array> = {};
    files['.kb_template.json'] = strToU8(JSON.stringify(applied.meta, null, 2));
    files['AI_CONFIG.md'] = strToU8(applied.aiConfigContent);
    for (const d of applied.meta.dirs) {
      const dirName = `${d.id} ${d.name}`;
      const readme = applied.dirReadmes[d.id];
      const tpl = applied.dirNoteTemplates[d.id];
      if (readme) files[`${dirName}/README.md`] = strToU8(readme);
      if (tpl) files[`${dirName}/.template.md`] = strToU8(tpl);
    }
    return zipSync(files, { level: 6 });
  }

  /**
   * 导入模板
   */
  async importTo(kbId: string, data: Uint8Array): Promise<AppliedTemplate> {
    const kb = getKB(kbId);
    if (!kb) throw new Error('知识库不存在');
    const unzipped = unzipSync(data);
    const metaRaw = strFromU8(unzipped['.kb_template.json']);
    const meta = JSON.parse(metaRaw) as TemplateMeta;
    const dstRoot = kb.rootPath;
    await ensureDir(dstRoot);
    // 写入 meta
    await atomicWrite(join(dstRoot, '.kb_template.json'), metaRaw);
    if (unzipped['AI_CONFIG.md']) {
      const exists = await fs.access(join(dstRoot, 'AI_CONFIG.md')).then(() => true).catch(() => false);
      if (!exists) await atomicWrite(join(dstRoot, 'AI_CONFIG.md'), strFromU8(unzipped['AI_CONFIG.md']));
    }
    for (const d of meta.dirs) {
      const dirName = `${d.id} ${d.name}`;
      const dstDir = join(dstRoot, dirName);
      const exists = await fs.access(dstDir).then(() => true).catch(() => false);
      if (exists) continue;
      await ensureDir(dstDir);
      const readme = unzipped[`${dirName}/README.md`];
      const tpl = unzipped[`${dirName}/.template.md`];
      if (readme) await atomicWrite(join(dstDir, 'README.md'), strFromU8(readme));
      if (tpl) await atomicWrite(join(dstDir, '.template.md'), strFromU8(tpl));
    }
    updateKBTemplate(kbId, meta.templateId);
    kbService.invalidateMeta(dstRoot);
    return (await this.loadApplied(kbId))!;
  }

  async getAIConfig(kbId: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return '';
    try {
      return await fs.readFile(join(kb.rootPath, 'AI_CONFIG.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  async saveAIConfig(kbId: string, content: string): Promise<void> {
    const kb = getKB(kbId);
    if (!kb) return;
    await atomicWrite(join(kb.rootPath, 'AI_CONFIG.md'), content);
    kbService.invalidateMeta(kb.rootPath);
  }

  async getDirReadme(kbId: string, dirPath: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return '';
    try {
      return await fs.readFile(join(kb.rootPath, dirPath, 'README.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  async saveDirReadme(kbId: string, dirPath: string, content: string): Promise<void> {
    const kb = getKB(kbId);
    if (!kb) return;
    await atomicWrite(join(kb.rootPath, dirPath, 'README.md'), content);
    kbService.invalidateMeta(kb.rootPath);
  }

  /**
   * 获取某目录的笔记模板信息（含内置默认，用于预览/重置）
   */
  async getNoteTemplateInfo(kbId: string, dirPath: string): Promise<NoteTemplateInfo | null> {
    const kb = getKB(kbId);
    if (!kb) return null;
    const applied = await this.loadApplied(kbId);
    if (!applied) return null;
    const name = basename(dirPath);
    const dir = applied.meta.dirs.find(
      (d) => `${d.id} ${d.name}` === name || d.name === name
    );
    if (!dir) return null;

    const realDir = `${dir.id} ${dir.name}`;
    let content = '';
    try {
      content = await fs.readFile(join(kb.rootPath, realDir, '.template.md'), 'utf-8');
    } catch {}

    // 内置默认模板（从模板资源目录读取）
    let builtinContent = '';
    try {
      const srcDir = join(builtinTemplatePath(), realDir);
      builtinContent = await fs.readFile(join(srcDir, '.template.md'), 'utf-8');
    } catch {}

    return {
      dirId: dir.id,
      dirName: dir.name,
      dirPath: realDir,
      content,
      builtinContent: builtinContent || undefined,
      hasCustom: !!content && content !== builtinContent,
      variables: ['{{name}}', '{{kbName}}', '{{date}}', '{{time}}', '{{timestamp}}']
    };
  }

  /**
   * 保存某目录的笔记模板
   */
  async saveNoteTemplate(kbId: string, dirPath: string, content: string): Promise<void> {
    const kb = getKB(kbId);
    if (!kb) return;
    await atomicWrite(join(kb.rootPath, dirPath, '.template.md'), content);
    kbService.invalidateMeta(kb.rootPath);
  }

  /**
   * 重置某目录笔记模板为内置默认
   */
  async resetNoteTemplate(kbId: string, dirPath: string): Promise<NoteTemplateInfo | null> {
    const kb = getKB(kbId);
    if (!kb) return null;
    const applied = await this.loadApplied(kbId);
    if (!applied) return null;
    const name = basename(dirPath);
    const dir = applied.meta.dirs.find(
      (d) => `${d.id} ${d.name}` === name || d.name === name
    );
    if (!dir) return null;
    const realDir = `${dir.id} ${dir.name}`;
    const srcDir = join(builtinTemplatePath(), realDir);
    try {
      const builtin = await fs.readFile(join(srcDir, '.template.md'), 'utf-8');
      await atomicWrite(join(kb.rootPath, realDir, '.template.md'), builtin);
      kbService.invalidateMeta(kb.rootPath);
      return await this.getNoteTemplateInfo(kbId, realDir);
    } catch {
      // 无内置模板则置空
      await atomicWrite(join(kb.rootPath, realDir, '.template.md'), '');
      kbService.invalidateMeta(kb.rootPath);
      return await this.getNoteTemplateInfo(kbId, realDir);
    }
  }

  /**
   * 预览填充变量后的笔记模板
   */
  async previewNoteTemplate(kbId: string, dirPath: string, noteName?: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return '';
    const applied = await this.loadApplied(kbId);
    if (!applied) return '';
    const info = await this.getNoteTemplateInfo(kbId, dirPath);
    if (!info) return '';
    const name = basename(dirPath);
    const dir = applied.meta.dirs.find((d) => `${d.id} ${d.name}` === name || d.name === name);
    const realName = noteName || '示例笔记';
    return this.fillTemplateVars(info.content, { name: realName, kbName: kb.name });
  }

  /**
   * 模板变量填充（统一入口，供 fs-service 复用）
   */
  fillTemplateVars(tpl: string, vars: { name: string; kbName: string }): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    const timestamp = String(Math.floor(now.getTime() / 1000));
    return tpl
      .replace(/\{\{name\}\}/g, vars.name)
      .replace(/\{\{kbName\}\}/g, vars.kbName)
      .replace(/\{\{date\}\}/g, date)
      .replace(/\{\{time\}\}/g, time)
      .replace(/\{\{timestamp\}\}/g, timestamp);
  }

  /**
   * 获取某目录的笔记模板
   */
  async getNoteTemplateForDir(kbId: string, dirPath: string): Promise<string | null> {
    const kb = getKB(kbId);
    if (!kb) return null;
    try {
      return await fs.readFile(join(kb.rootPath, dirPath, '.template.md'), 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 通过目录路径查找模板 dirId
   */
  async findDirIdByPath(kbId: string, dirPath: string): Promise<string | null> {
    const applied = await this.loadApplied(kbId);
    if (!applied) return null;
    const name = basename(dirPath);
    for (const d of applied.meta.dirs) {
      if (`${d.id} ${d.name}` === name || d.name === name) return d.id;
    }
    return null;
  }
}

export const templateService = new TemplateService();
