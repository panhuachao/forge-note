// 笔记版本管理服务（doc/笔记版本实现方案.md）
//
// 为笔记提供完整的版本记录：自动留存历史、比对差异、一键恢复。
//
// 设计要点：
// - 落盘沿用项目 .forge 约定：<kbRoot>/.forge/versions/<noteId>/
// - noteId = sha1(首次纳入版本管理的路径).slice(0,16)，终身不变，
//   因此 move / rename 只需更新 index 里的路径映射，无需搬运内容目录。
// - 时间戳自记录：atomicWrite 用 rename 会替换 inode，birthtime/ctime 不可信。
// - 自动快照需节流（NotePane 自动保存是 500ms 防抖，直接当版本会爆炸），
//   见 SnapshotScheduler。
// - 所有对外方法内部静默吞错：版本是增值能力，不能因它失败导致笔记保存失败。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'crypto';
import { getKB } from './store';
import { fsService } from './fs-service';
import { auditService } from './audit-service';
import { eventBus } from '../utils/event-bus';
import { atomicWrite } from '../utils/fs';
import { diffStats, structuredDiff, makeUnifiedDiff, type DiffLine } from '../utils/diff';
import type {
  NoteVersion,
  NoteVersionMeta,
  VersionIndex,
  VersionListItem,
  VersionSource,
  VersionSummary
} from '@shared/types/version';

/* ==================== 常量 ==================== */

/** 版本根目录（相对 KB root） */
const VERSIONS_DIR = path.join('.forge', 'versions');
/** 已删除笔记的版本暂存区 */
const ORPHAN_DIR = 'orphan';
/** 自动快照静默期：距上次版本超过该时长才创建新版本 */
const AUTO_QUIET_MS = 3 * 60_000;
/** 自动快照：最后一次变化后需静默该时长（避免打字中途打断成多个版本） */
const AUTO_IDLE_MS = 3 * 60_000;
/** 单笔记版本数量上限 */
const MAX_PER_NOTE = 50;
/** 时间分层：7 天内全保留 */
const KEEP_ALL_DAYS = 7;
/** 时间分层：7~30 天每天保留最新 1 个 */
const KEEP_DAILY_DAYS = 30;
/** 30 天以上每周保留最新 1 个（其余淘汰） */
/** orphan 保留时长 */
const ORPHAN_TTL = 30 * 86400_000;
/** 版本区体积上限（字节）：超过则按最旧优先淘汰 */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

/** noteId：基于路径的哈希，终身不变 */
function noteIdOf(notePath: string): string {
  return sha1(notePath).slice(0, 16);
}

/* ==================== 待处理变更（节流调度） ==================== */

interface PendingChange {
  kbId: string;
  notePath: string;
  /** 首次检测到变化 */
  since: number;
  /** 最后一次变化 */
  lastChangeAt: number;
  /** 是否为高优先级来源（AI / 恢复前 / 移动前 → 立即创建） */
  force?: boolean;
  source: VersionSource;
  note?: string;
  /** setTimeout 句柄：每个笔记独立，重置静默期 */
  timer?: NodeJS.Timeout;
}

class SnapshotScheduler {
  private pending = new Map<string, PendingChange>();

  /** 记录一次内容变化（同步、O(1)，由 fs-service 埋点调用） */
  record(kbId: string, notePath: string, source: VersionSource = 'auto', note?: string, force = false): void {
    const key = `${kbId}::${notePath}`;
    const now = Date.now();
    const exist = this.pending.get(key);
    if (exist) {
      exist.lastChangeAt = now;
      // 高优先级来源可升级：例如编辑中途触发了 AI 修改
      if (force) {
        exist.force = true;
        exist.source = source;
        if (note) exist.note = note;
        // 强制落盘时取消静默定时器，立即 flush
        if (exist.timer) {
          clearTimeout(exist.timer);
          exist.timer = undefined;
        }
        void this.flushKey(key);
        return;
      }
      // 普通编辑：重置静默期定时器（总是在最后编辑后 3 分钟创建）
      this.reschedule(exist);
      return;
    }
    const p: PendingChange = { kbId, notePath, since: now, lastChangeAt: now, source, note, force };
    this.pending.set(key, p);
    if (force) {
      void this.flushKey(key);
    } else {
      this.reschedule(p);
    }
  }

  /** 为某个 pending 项设置/重置静默期定时器 */
  private reschedule(p: PendingChange): void {
    if (p.timer) clearTimeout(p.timer);
    // 使用 ref timer：Electron 主进程空闲时也不会被跳过
    p.timer = setTimeout(() => void this.onTimeout(`${p.kbId}::${p.notePath}`), AUTO_QUIET_MS);
  }

  /** 静默期到期：检查是否仍在编辑，否则落盘 */
  private async onTimeout(key: string): Promise<void> {
    const p = this.pending.get(key);
    if (!p) return;
    const now = Date.now();
    // 到期前若又发生了编辑，lastChangeAt 会被更新，此时应继续等待
    if (now - p.lastChangeAt < AUTO_IDLE_MS) {
      this.reschedule(p);
      return;
    }
    await this.flushKey(key);
  }

  private async flushKey(key: string): Promise<void> {
    const p = this.pending.get(key);
    if (!p) return;
    if (p.timer) {
      clearTimeout(p.timer);
      p.timer = undefined;
    }
    this.pending.delete(key);
    try {
      await versionService.create(p.kbId, p.notePath, { source: p.source, note: p.note, force: p.force });
    } catch {
      /* 静默：版本失败不影响主流程 */
    }
  }

  /** 应用退出前把所有待处理变更落盘 */
  async flushAll(): Promise<void> {
    const keys = [...this.pending.keys()];
    for (const k of keys) await this.flushKey(k);
  }
}

const scheduler = new SnapshotScheduler();

/* ==================== 版本服务 ==================== */

class VersionService {
  /* ---------- 路径工具 ---------- */

  private versionsRoot(kbId: string): string | null {
    try {
      const kb = getKB(kbId);
      return kb ? path.join(kb.rootPath, VERSIONS_DIR) : null;
    } catch {
      return null;
    }
  }

  /** 优先在普通区找，找不到再去 orphan 区找（笔记曾被删除过） */
  private noteDir(kbId: string, noteId: string, orphan = false): string | null {
    const root = this.versionsRoot(kbId);
    if (!root) return null;
    return path.join(root, orphan ? ORPHAN_DIR : '', noteId);
  }

  private async resolveNoteDir(kbId: string, noteId: string): Promise<string | null> {
    const normal = this.noteDir(kbId, noteId);
    if (normal && fs.existsSync(normal)) return normal;
    const orphan = this.noteDir(kbId, noteId, true);
    if (orphan && fs.existsSync(orphan)) return orphan;
    return normal;
  }

  private indexPath(kbId: string): string | null {
    const root = this.versionsRoot(kbId);
    return root ? path.join(root, 'index.json') : null;
  }

  /* ---------- 索引读写 ---------- */

  private async readIndex(kbId: string): Promise<VersionIndex> {
    const f = this.indexPath(kbId);
    if (!f || !fs.existsSync(f)) return { version: 1, notes: {} };
    try {
      return (JSON.parse(await fs.promises.readFile(f, 'utf-8')) as VersionIndex) ?? { version: 1, notes: {} };
    } catch {
      return { version: 1, notes: {} };
    }
  }

  private async writeIndex(kbId: string, index: VersionIndex): Promise<void> {
    const f = this.indexPath(kbId);
    if (!f) return;
    try {
      await atomicWrite(f, JSON.stringify(index));
    } catch {
      /* 静默 */
    }
  }

  private async readMeta(kbId: string, noteId: string): Promise<NoteVersionMeta | null> {
    const dir = await this.resolveNoteDir(kbId, noteId);
    if (!dir) return null;
    const f = path.join(dir, 'meta.json');
    if (!fs.existsSync(f)) return null;
    try {
      return JSON.parse(await fs.promises.readFile(f, 'utf-8')) as NoteVersionMeta;
    } catch {
      return null;
    }
  }

  private async writeMeta(kbId: string, meta: NoteVersionMeta): Promise<void> {
    const dir = await this.resolveNoteDir(kbId, meta.noteId);
    if (!dir) return;
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await atomicWrite(path.join(dir, 'meta.json'), JSON.stringify(meta));
    } catch {
      /* 静默 */
    }
  }

  /** 从笔记路径提取标题（去目录与扩展名） */
  private titleOf(notePath: string): string {
    return (notePath.split('/').pop() || notePath).replace(/\.md$/i, '');
  }

  /* ---------- 查询 ---------- */

  /** 列出某笔记的所有版本（新→旧），带快照存在性校验 */
  async list(kbId: string, notePath: string): Promise<VersionListItem[]> {
    try {
      const noteId = noteIdOf(notePath);
      const meta = await this.readMeta(kbId, noteId);
      if (!meta) return [];
      const dir = await this.resolveNoteDir(kbId, noteId);
      return meta.versions.map((v) => ({
        ...v,
        available: !!dir && fs.existsSync(path.join(dir, `${v.id}.md`))
      }));
    } catch {
      return [];
    }
  }

  /** 版本概览（RightPanel 展示计数与最近时间） */
  async summary(kbId: string, notePath: string): Promise<VersionSummary> {
    const meta = await this.readMeta(kbId, noteIdOf(notePath));
    if (!meta || !meta.versions.length) return { count: 0, lastAt: null };
    return { count: meta.versions.length, lastAt: meta.versions[0].at };
  }

  /** 读取某版本的完整内容 */
  async getContent(kbId: string, notePath: string, versionId: string): Promise<string | null> {
    try {
      const noteId = noteIdOf(notePath);
      const dir = await this.resolveNoteDir(kbId, noteId);
      if (!dir) return null;
      const f = path.join(dir, `${versionId}.md`);
      if (!fs.existsSync(f)) return null;
      return await fs.promises.readFile(f, 'utf-8');
    } catch {
      return null;
    }
  }

  /* ---------- 创建 ---------- */

  /**
   * 创建版本。
   * @param opts.force 为 true 时跳过节流与去重（手动 / AI / 恢复前 / 移动前）
   * @returns 新版本 id；被节流或内容去重跳过时返回 null
   */
  async create(
    kbId: string,
    notePath: string,
    opts?: { source?: VersionSource; note?: string; force?: boolean }
  ): Promise<string | null> {
    try {
      const source = opts?.source ?? 'auto';
      // 非强制来源统一走调度器节流（由 per-note setTimeout 异步落盘）
      if (!opts?.force && source === 'auto') {
        scheduler.record(kbId, notePath, source, opts?.note, false);
        return null;
      }

      const raw = await fsService.readText(kbId, notePath).catch(() => null);
      if (raw == null) return null;

      const noteId = noteIdOf(notePath);
      const dir = await this.resolveNoteDir(kbId, noteId);
      if (!dir) return null;
      await fs.promises.mkdir(dir, { recursive: true });

      const hash = sha1(raw);
      const at = Date.now();
      let meta = await this.readMeta(kbId, noteId);
      if (!meta) {
        meta = { noteId, notePath, title: this.titleOf(notePath), versions: [], updatedAt: at };
      } else {
        meta.notePath = notePath;
        meta.title = this.titleOf(notePath);
      }

      // 内容去重：与最新版本内容一致则跳过
      const latest = meta.versions[0];
      if (latest && latest.hash === hash) return null;

      // 相对上一版本的增删行数
      let delta: NoteVersion['delta'] = null;
      if (latest) {
        const prev = await this.getContent(kbId, notePath, latest.id);
        if (prev != null) {
          const s = diffStats(prev, raw);
          delta = { added: s.added, removed: s.removed };
        }
      }

      const id = `v_${at.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await atomicWrite(path.join(dir, `${id}.md`), raw);

      meta.versions.unshift({
        id,
        noteId,
        at,
        source,
        note: opts?.note,
        hash,
        size: Buffer.byteLength(raw, 'utf-8'),
        delta
      });
      meta.updatedAt = at;
      await this.writeMeta(kbId, meta);
      await this.updateIndexEntry(kbId, noteId, notePath, meta);

      // 异步淘汰，不阻塞
      void this.prune(kbId);
      return id;
    } catch {
      return null;
    }
  }

  /** 记录一次内容变化（fs-service 埋点入口，同步且开销极低） */
  recordChange(kbId: string, notePath: string, source: VersionSource = 'auto', note?: string, force = false): void {
    try {
      scheduler.record(kbId, notePath, source, note, force);
    } catch {
      /* 静默 */
    }
  }

  private async updateIndexEntry(
    kbId: string,
    noteId: string,
    notePath: string,
    meta: NoteVersionMeta
  ): Promise<void> {
    const index = await this.readIndex(kbId);
    index.notes[noteId] = {
      notePath,
      title: this.titleOf(notePath),
      count: meta.versions.length,
      lastAt: meta.versions[0]?.at ?? Date.now()
    };
    await this.writeIndex(kbId, index);
  }

  /* ---------- 删除 ---------- */

  async remove(kbId: string, notePath: string, versionId: string): Promise<void> {
    try {
      const noteId = noteIdOf(notePath);
      const dir = await this.resolveNoteDir(kbId, noteId);
      const meta = await this.readMeta(kbId, noteId);
      if (!dir || !meta) return;
      meta.versions = meta.versions.filter((v) => v.id !== versionId);
      meta.updatedAt = Date.now();
      await this.writeMeta(kbId, meta);
      try {
        await fs.promises.unlink(path.join(dir, `${versionId}.md`));
      } catch {
        /* 快照本就不存在时忽略 */
      }
      await this.updateIndexEntry(kbId, noteId, notePath, meta);
    } catch {
      /* 静默 */
    }
  }

  /* ---------- 比对 ---------- */

  /**
   * 结构化 diff。a / b 支持特殊值 'current'（当前磁盘内容）与版本 id。
   */
  async diff(kbId: string, notePath: string, a: string, b: string): Promise<DiffLine[]> {
    const left = a === 'current' ? await fsService.readText(kbId, notePath).catch(() => '') : await this.getContent(kbId, notePath, a);
    const right = b === 'current' ? await fsService.readText(kbId, notePath).catch(() => '') : await this.getContent(kbId, notePath, b);
    return structuredDiff(left ?? '', right ?? '');
  }

  /** unified diff 文本（用于复制） */
  async diffText(kbId: string, notePath: string, a: string, b: string): Promise<string> {
    const left = a === 'current' ? await fsService.readText(kbId, notePath).catch(() => '') : await this.getContent(kbId, notePath, a);
    const right = b === 'current' ? await fsService.readText(kbId, notePath).catch(() => '') : await this.getContent(kbId, notePath, b);
    return makeUnifiedDiff(left ?? '', right ?? '');
  }

  /* ---------- 恢复 ---------- */

  /**
   * 恢复：先为当前内容创建 pre-restore 版本（保证可撤销），再写回目标版本内容。
   * 恢复后自动 syncIndex + emit fsChange，渲染层无需额外刷新。
   */
  async restore(kbId: string, notePath: string, versionId: string): Promise<{ ok: boolean; message: string }> {
    try {
      const content = await this.getContent(kbId, notePath, versionId);
      if (content == null) return { ok: false, message: '版本快照不存在或已损坏' };

      const current = await fsService.readText(kbId, notePath).catch(() => '');
      if (sha1(current) === sha1(content)) {
        return { ok: true, message: '当前内容与该版本一致，无需恢复' };
      }

      // 恢复前先存档当前内容，使恢复本身可撤销
      await this.create(kbId, notePath, { source: 'pre-restore', force: true });

      await fsService.writeText(kbId, notePath, content);
      await fsService.syncIndex(kbId, notePath);
      auditService.record(kbId, 'confirmableAction', {
        type: 'versionRestore',
        notePath,
        versionId,
        by: 'user'
      });
      eventBus.emit('fsChange', { type: 'change', path: notePath });
      return { ok: true, message: '已恢复到该版本' };
    } catch (e) {
      return { ok: false, message: `恢复失败：${String(e)}` };
    }
  }

  /* ---------- 生命周期 ---------- */

  /** move / rename 后更新路径映射（noteId 不变，内容目录无需搬运） */
  async onNoteMoved(kbId: string, fromPath: string, toPath: string): Promise<void> {
    try {
      const fromId = noteIdOf(fromPath);
      const meta = await this.readMeta(kbId, fromId);
      // 无历史版本时无需处理
      if (!meta) return;
      meta.notePath = toPath;
      meta.title = this.titleOf(toPath);
      meta.updatedAt = Date.now();
      await this.writeMeta(kbId, meta);
      const index = await this.readIndex(kbId);
      const entry = index.notes[fromId];
      if (entry) {
        entry.notePath = toPath;
        entry.title = meta.title;
        await this.writeIndex(kbId, index);
      }
    } catch {
      /* 静默 */
    }
  }

  /** 删除笔记：版本数据转入 orphan 区，30 天后清理 */
  async onNoteDeleted(kbId: string, notePath: string): Promise<void> {
    try {
      const noteId = noteIdOf(notePath);
      const root = this.versionsRoot(kbId);
      const src = this.noteDir(kbId, noteId);
      if (!root || !src || !fs.existsSync(src)) return;
      const dst = path.join(root, ORPHAN_DIR, noteId);
      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      await fs.promises.rename(src, dst);
      // 索引标记删除时间，供清理使用
      const index = await this.readIndex(kbId);
      if (index.notes[noteId]) {
        index.notes[noteId].notePath = `${ORPHAN_DIR}/${noteId}`;
        await this.writeIndex(kbId, index);
      }
    } catch {
      /* 静默 */
    }
  }

  /** 连同版本一起彻底删除 */
  async purgeNote(kbId: string, notePath: string): Promise<void> {
    try {
      const noteId = noteIdOf(notePath);
      for (const orphan of [false, true]) {
        const dir = this.noteDir(kbId, noteId, orphan);
        if (dir && fs.existsSync(dir)) await fs.promises.rm(dir, { recursive: true, force: true });
      }
      const index = await this.readIndex(kbId);
      delete index.notes[noteId];
      await this.writeIndex(kbId, index);
    } catch {
      /* 静默 */
    }
  }

  /* ---------- 淘汰 ---------- */

  /**
   * 执行淘汰策略：数量上限 + 时间分层 + 总体积上限。
   * 返回被清除的版本数与释放字节数。
   */
  async prune(kbId: string): Promise<{ removed: number; freedBytes: number }> {
    let removed = 0;
    let freedBytes = 0;
    try {
      const root = this.versionsRoot(kbId);
      if (!root || !fs.existsSync(root)) return { removed, freedBytes };
      const index = await this.readIndex(kbId);
      const now = Date.now();

      // ① 清理过期 orphan（>30 天）
      const orphanRoot = path.join(root, ORPHAN_DIR);
      if (fs.existsSync(orphanRoot)) {
        for (const d of await fs.promises.readdir(orphanRoot)) {
          const p = path.join(orphanRoot, d);
          const st = await fs.promises.stat(p).catch(() => null);
          if (st && now - st.mtimeMs > ORPHAN_TTL) {
            const size = await this.dirSize(p);
            await fs.promises.rm(p, { recursive: true, force: true });
            delete index.notes[d];
            freedBytes += size;
          }
        }
      }

      // ② 逐笔记应用数量与时间分层
      for (const noteId of Object.keys(index.notes)) {
        const meta = await this.readMeta(kbId, noteId);
        if (!meta?.versions?.length) continue;
        const dir = await this.resolveNoteDir(kbId, noteId);
        if (!dir) continue;

        const keep = pickKeep(meta.versions, now);
        const drop = meta.versions.filter((v) => !keep.has(v.id));
        for (const v of drop) {
          const f = path.join(dir, `${v.id}.md`);
          try {
            const st = await fs.promises.stat(f);
            freedBytes += st.size;
            await fs.promises.unlink(f);
            removed++;
          } catch {
            /* 文件本就不存在 */
          }
        }
        if (drop.length) {
          meta.versions = meta.versions.filter((v) => keep.has(v.id));
          meta.updatedAt = now;
          await this.writeMeta(kbId, meta);
          const e = index.notes[noteId];
          if (e) {
            e.count = meta.versions.length;
            e.lastAt = meta.versions[0]?.at ?? e.lastAt;
          }
        }
      }
      await this.writeIndex(kbId, index);

      // ③ 总体积兜底：仍超限则按最旧优先继续淘汰
      let total = await this.totalSize(kbId);
      if (total > MAX_TOTAL_BYTES) {
        const all: { kbId: string; noteId: string; v: NoteVersion }[] = [];
        for (const noteId of Object.keys(index.notes)) {
          const meta = await this.readMeta(kbId, noteId);
          for (const v of meta?.versions ?? []) all.push({ kbId, noteId, v });
        }
        all.sort((x, y) => x.v.at - y.v.at);
        for (const item of all) {
          if (total <= MAX_TOTAL_BYTES) break;
          const dir = await this.resolveNoteDir(kbId, item.noteId);
          if (!dir) continue;
          const f = path.join(dir, `${item.v.id}.md`);
          const st = await fs.promises.stat(f).catch(() => null);
          if (!st) continue;
          await fs.promises.unlink(f).catch(() => {});
          freedBytes += st.size;
          total -= st.size;
          removed++;
          const meta = await this.readMeta(kbId, item.noteId);
          if (meta) {
            meta.versions = meta.versions.filter((v) => v.id !== item.v.id);
            await this.writeMeta(kbId, meta);
            const e = index.notes[item.noteId];
            if (e) e.count = meta.versions.length;
          }
        }
        await this.writeIndex(kbId, index);
      }
    } catch {
      /* 静默 */
    }
    return { removed, freedBytes };
  }

  /** 版本区总字节数（供巡检与 UI 展示） */
  async totalSize(kbId: string): Promise<number> {
    const root = this.versionsRoot(kbId);
    if (!root || !fs.existsSync(root)) return 0;
    return await this.dirSize(root);
  }

  private async dirSize(dir: string): Promise<number> {
    let total = 0;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) total += await this.dirSize(p);
        else {
          const st = await fs.promises.stat(p).catch(() => null);
          if (st) total += st.size;
        }
      }
    } catch {
      /* 静默 */
    }
    return total;
  }

  /* ---------- 退出前 flush ---------- */

  async flushPending(): Promise<void> {
    await scheduler.flushAll();
  }
}

/**
 * 时间分层 + 数量上限：返回需要保留的版本 id 集合。
 * - 7 天内：全保留
 * - 7~30 天：每天保留最新 1 个
 * - 30 天以上：每周保留最新 1 个
 * - 总量超过 MAX_PER_NOTE 时，超出部分从最旧的开始丢弃（但至少保留最新 1 个）
 */
function pickKeep(versions: NoteVersion[], now: number): Set<string> {
  const sorted = [...versions].sort((a, b) => b.at - a.at); // 新 → 旧
  const keep = new Set<string>();
  const daily = new Set<string>();
  const weekly = new Set<string>();

  for (const v of sorted) {
    const ageDays = (now - v.at) / 86400_000;
    if (ageDays <= KEEP_ALL_DAYS) {
      keep.add(v.id);
    } else if (ageDays <= KEEP_DAILY_DAYS) {
      const day = new Date(v.at).toDateString();
      if (!daily.has(day)) {
        daily.add(day);
        keep.add(v.id);
      }
    } else {
      const week = `${Math.floor(v.at / (7 * 86400_000))}`;
      if (!weekly.has(week)) {
        weekly.add(week);
        keep.add(v.id);
      }
    }
  }

  // 数量上限：按时间从新到旧截断
  if (keep.size > MAX_PER_NOTE) {
    const truncated = sorted.slice(0, MAX_PER_NOTE).map((v) => v.id);
    return new Set(truncated);
  }
  return keep;
}

export const versionService = new VersionService();
