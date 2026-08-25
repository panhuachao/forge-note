// 文件监听 - chokidar 包装
import chokidar, { FSWatcher } from 'chokidar';
import { join } from 'path';
import { promises as fs } from 'fs';
import { getKB } from './store';
import { extractWikiLinks } from '../utils/markdown';
import { linkIndex } from './link-index';
import { eventBus } from '../utils/event-bus';
import { isMarkdown, isHidden } from '../utils/fs';
import { kbService } from './kb-service';

const watchers = new Map<string, FSWatcher>();

export async function startWatching(kbId: string): Promise<void> {
  if (watchers.has(kbId)) return;
  const kb = getKB(kbId);
  if (!kb) return;
  const watcher = chokidar.watch(kb.rootPath, {
    ignored: (path: string) => {
      const base = path.split(/[/\\]/).pop() || '';
      if (base.startsWith('.') && base !== '.kb_template.json') return true;
      // 允许 README/AI_CONFIG/.template 触发
      return false;
    },
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    },
    persistent: true
  });

  watcher
    .on('add', (p) => {
      if (isHidden(p.split(/[/\\]/).pop() || '')) return;
      if (isMarkdown(p)) {
        // 预热索引
        fs.readFile(p, 'utf-8').then((c) => linkIndex.updateOutlinks(kbId, p.replace(kb.rootPath + '/', ''), extractWikiLinks(c))).catch(() => {});
        eventBus.emit('fsChange', { type: 'add', path: p.replace(kb.rootPath + '/', ''), isDir: false });
      }
    })
    .on('change', async (p) => {
      const rel = p.replace(kb.rootPath + '/', '');
      if (p.endsWith('.AI_CONFIG.md')) {
        // 触发模板/AI 配置热更新
        kbService.invalidateMeta(kb.rootPath);
      }
      if (isMarkdown(p)) {
        try {
          const c = await fs.readFile(p, 'utf-8');
          linkIndex.updateOutlinks(kbId, rel, extractWikiLinks(c));
        } catch {}
      }
      eventBus.emit('fsChange', { type: 'change', path: rel });
    })
    .on('unlink', (p) => {
      const rel = p.replace(kb.rootPath + '/', '');
      linkIndex.removeNote(kbId, rel);
      eventBus.emit('fsChange', { type: 'unlink', path: rel, isDir: false });
    })
    .on('addDir', (p) => eventBus.emit('fsChange', { type: 'addDir', path: p.replace(kb.rootPath + '/', '') }))
    .on('unlinkDir', (p) => {
      kbService.invalidateMeta(kb.rootPath);
      eventBus.emit('fsChange', { type: 'unlinkDir', path: p.replace(kb.rootPath + '/', '') });
    })
    .on('error', (err) => console.error('[watcher]', err));

  watchers.set(kbId, watcher);
}

export async function stopWatching(kbId: string): Promise<void> {
  const w = watchers.get(kbId);
  if (w) {
    await w.close();
    watchers.delete(kbId);
  }
}

export async function stopAll(): Promise<void> {
  for (const [, w] of watchers) await w.close();
  watchers.clear();
}

/**
 * 启动时全量扫描，建立链接索引
 */
export async function bootstrapIndex(kbId: string): Promise<void> {
  const kb = getKB(kbId);
  if (!kb) return;
  await walk(kb.rootPath, '', kbId, kb.rootPath);
}

async function walk(abs: string, rel: string, kbId: string, root: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (isHidden(e.name) && e.name !== '.kb_template.json') continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const childAbs = join(abs, e.name);
    if (e.isDirectory()) {
      await walk(childAbs, childRel, kbId, root);
    } else if (isMarkdown(e.name)) {
      try {
        const c = await fs.readFile(childAbs, 'utf-8');
        linkIndex.updateOutlinks(kbId, childRel, extractWikiLinks(c));
      } catch {}
    }
  }
}
