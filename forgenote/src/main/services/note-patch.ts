// 笔记 Patch：预览 / 应用（doc/MCP技术实现方案.md §4）
// 设计要点：
// - Patch 在内存中作用于「含 frontmatter 的原始 markdown」，预览时不落盘；
// - 预览结果存入 previewStore，模型只引用 previewId（避免把整段 diff 塞回上下文）；
// - 应用时优先使用 previewId 对应的原始 ops（防止模型在确认轮次偷换 Patch），
//   并用内容 hash 做乐观锁，避免「预览后笔记已被改动」导致误改。
import { createHash } from 'crypto';
import matter from 'gray-matter';
import { fsService } from './fs-service';
import { auditService } from './audit-service';
import { readFrontmatter } from '../utils/markdown';
import type { NotePatchOp, NotePatchPreview } from '@shared/types/ai';

interface StoredPreview {
  kbId: string;
  notePath: string;
  ops: NotePatchOp[];
  /** 预览时原文 hash，用于乐观锁 */
  beforeHash: string;
  diff: string;
  affectedLines: number;
  canApply: boolean;
  message?: string;
  createdAt: number;
}

const previewStore = new Map<string, StoredPreview>();

/** 清理过期预览（默认 30 分钟） */
export function prunePreviews(maxAgeMs = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, p] of previewStore) {
    if (now - p.createdAt > maxAgeMs) previewStore.delete(id);
  }
}

/** 取回已存的预览（供渲染层展示 diff） */
export function getStoredPreview(previewId: string): NotePatchPreview | null {
  prunePreviews();
  const p = previewStore.get(previewId);
  if (!p) return null;
  return {
    previewId,
    notePath: p.notePath,
    canApply: p.canApply,
    diff: p.diff,
    affectedLines: p.affectedLines,
    message: p.message
  };
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

/** 把未知入参规范化为 PatchOp 数组 */
export function normalizeOps(raw: unknown): NotePatchOp[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: NotePatchOp[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const op = String(o.op ?? '');
    if (!['set_frontmatter', 'replace', 'insert_after', 'append', 'delete_lines'].includes(op)) continue;
    out.push({
      op: op as NotePatchOp['op'],
      key: o.key != null ? String(o.key) : undefined,
      value: o.value,
      oldText: o.oldText != null ? String(o.oldText) : undefined,
      newText: o.newText != null ? String(o.newText) : undefined,
      anchor: o.anchor != null ? String(o.anchor) : undefined,
      text: o.text != null ? String(o.text) : undefined,
      startLine: Number.isFinite(Number(o.startLine)) ? Number(o.startLine) : undefined,
      endLine: Number.isFinite(Number(o.endLine)) ? Number(o.endLine) : undefined
    });
  }
  return out;
}

/**
 * 在内存中应用 Patch，返回新的原始 markdown（含 frontmatter）。
 * 不写盘。ok=false 表示存在无法命中的操作（如 replace 的 oldText 不存在）。
 */
function applyPatchOps(raw: string, ops: NotePatchOp[]): { raw: string; ok: boolean; affected: number; message?: string } {
  const { data, content: body } = readFrontmatter(raw);
  const nextData: Record<string, unknown> = { ...(data || {}) };
  let content = body;
  let ok = true;
  let affected = 0;
  const messages: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case 'set_frontmatter': {
        const key = String(op.key || '').trim();
        if (!key) {
          ok = false;
          messages.push('set_frontmatter 缺少 key');
          break;
        }
        nextData[key] = op.value;
        affected += 1;
        break;
      }
      case 'replace': {
        const oldText = String(op.oldText ?? '');
        const newText = String(op.newText ?? '');
        if (!oldText) {
          ok = false;
          messages.push('replace 缺少 oldText');
          break;
        }
        if (!content.includes(oldText)) {
          ok = false;
          messages.push(`replace 未命中文本: ${oldText.slice(0, 40)}`);
          break;
        }
        const count = content.split(oldText).length - 1;
        content = content.split(oldText).join(newText);
        affected += count;
        break;
      }
      case 'insert_after': {
        const anchor = String(op.anchor ?? '');
        const text = String(op.text ?? '');
        if (!anchor) {
          ok = false;
          messages.push('insert_after 缺少 anchor');
          break;
        }
        const idx = content.indexOf(anchor);
        if (idx < 0) {
          ok = false;
          messages.push(`insert_after 未命中锚点: ${anchor.slice(0, 40)}`);
          break;
        }
        const at = idx + anchor.length;
        content = content.slice(0, at) + '\n' + text + content.slice(at);
        affected += 1;
        break;
      }
      case 'append': {
        const text = String(op.text ?? '');
        if (!text) {
          ok = false;
          messages.push('append 缺少 text');
          break;
        }
        content = (content ? content.replace(/\s*$/, '') + '\n\n' : '') + text + '\n';
        affected += 1;
        break;
      }
      case 'delete_lines': {
        const start = Number(op.startLine);
        const end = Number(op.endLine ?? op.startLine);
        if (!Number.isFinite(start) || start < 1) {
          ok = false;
          messages.push('delete_lines 行号非法');
          break;
        }
        const lines = content.split('\n');
        const from = start - 1;
        const to = Math.min(lines.length, Math.max(end, start));
        if (from >= lines.length) {
          ok = false;
          messages.push('delete_lines 超出正文范围');
          break;
        }
        lines.splice(from, to - from);
        content = lines.join('\n');
        affected += to - from;
        break;
      }
      default:
        ok = false;
        messages.push(`未知 op: ${String((op as { op?: string }).op)}`);
    }
  }

  const nextRaw = Object.keys(nextData).length > 0 ? matter.stringify(content, nextData) : content;
  return { raw: nextRaw, ok, affected, message: messages.length ? messages.join('；') : undefined };
}

/**
 * 简易行级 unified diff（无外部依赖）。
 * 超大文档（行数组合超过阈值）退化为「仅统计 + 截断预览」，避免 O(n*m) 内存爆炸。
 */
function makeUnifiedDiff(before: string, after: string, context = 2): string {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000) {
    return `（文档过大，已跳过逐行 diff；修改后共 ${b.length} 行）`;
  }

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: { type: ' ' | '-' | '+'; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: '-', line: a[i] });
      i++;
    } else {
      ops.push({ type: '+', line: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: '-', line: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: '+', line: b[j] });
    j++;
  }

  // 仅保留变更行附近 context 行
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type === ' ') continue;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  }
  const out: string[] = [];
  let last = -1;
  for (let idx = 0; idx < ops.length; idx++) {
    if (!keep[idx]) continue;
    if (last >= 0 && idx - last > 1) out.push('@@ ...');
    out.push(`${ops[idx].type}${ops[idx].line}`);
    last = idx;
  }
  return out.join('\n');
}

/** 生成修改预览（不落盘），并把 ops 存入 previewStore */
export async function previewNotePatch(kbId: string, notePath: string, ops: NotePatchOp[]): Promise<NotePatchPreview> {
  prunePreviews();
  const raw = await fsService.readText(kbId, notePath);
  const res = applyPatchOps(raw, ops);
  const diff = makeUnifiedDiff(raw, res.raw);
  const previewId = `pv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  previewStore.set(previewId, {
    kbId,
    notePath,
    ops,
    beforeHash: sha1(raw),
    diff,
    affectedLines: res.affected,
    canApply: res.ok,
    message: res.message,
    createdAt: Date.now()
  });
  return { previewId, notePath, canApply: res.ok, diff, affectedLines: res.affected, message: res.message };
}

/**
 * 应用修改（落盘）。
 * 若传入 previewId 且能取到，则以「预览时的 ops」为准（所见即所改），
 * 并校验原文未发生变化；否则回退为直接使用传入的 ops。
 */
export async function applyNotePatch(
  kbId: string,
  notePath: string,
  ops: NotePatchOp[],
  previewId?: string
): Promise<{ ok: boolean; message: string; affected: number; ops: NotePatchOp[] }> {
  prunePreviews();
  const stored = previewId ? previewStore.get(previewId) : undefined;
  const finalOps = stored?.ops?.length ? stored.ops : ops;
  if (!finalOps.length) return { ok: false, message: '没有可应用的修改操作', affected: 0, ops: [] };

  const raw = await fsService.readText(kbId, notePath);
  if (stored && stored.beforeHash !== sha1(raw)) {
    return { ok: false, message: '笔记在预览之后已被改动，请重新生成修改建议', affected: 0, ops: finalOps };
  }
  if (stored && stored.notePath !== notePath) {
    return { ok: false, message: '预览与目标笔记不一致，已拒绝应用', affected: 0, ops: finalOps };
  }

  const res = applyPatchOps(raw, finalOps);
  if (!res.ok) return { ok: false, message: res.message || '修改无法应用', affected: 0, ops: finalOps };

  await fsService.writeText(kbId, notePath, res.raw);
  // 同步检索索引与 SQLite（writeText 只落盘 + 发事件，不含索引同步）
  await fsService.syncIndex(kbId, notePath);
  auditService.record(kbId, 'aiPatch', { notePath, ops: finalOps, previewId: previewId ?? null, by: 'ai' });
  if (previewId) previewStore.delete(previewId);

  // 回传实际生效的 ops：供执行后验证（verify）使用。
  // 只带 previewId 的调用在预览被消费后已拿不到 ops，这里补回。
  return { ok: true, message: `已应用修改：${notePath}`, affected: res.affected, ops: finalOps };
}

/* ==================== 回滚快照与执行后验证（方案 §6.3 · P2-3） ====================
 * 此前确认流的生命周期是「确认 → 执行 → 结束」，执行后既不校验也不支持撤销。
 * 补齐后可形成完整闭环：确认 → 执行 → 自动验证 → （未达预期）一键回滚。
 */

interface StoredSnapshot {
  kbId: string;
  notePath: string;
  /** 应用修改前的完整原文（含 frontmatter） */
  raw: string;
  at: number;
}

const snapshotStore = new Map<string, StoredSnapshot>();
/** 快照保留时长 */
const SNAPSHOT_TTL = 60 * 60_000;

function pruneSnapshots(): void {
  const now = Date.now();
  for (const [id, s] of snapshotStore) {
    if (now - s.at > SNAPSHOT_TTL) snapshotStore.delete(id);
  }
}

/** 保存笔记当前内容作为回滚点，返回 snapshotId（失败返回 null，不阻断主流程） */
export async function saveSnapshot(kbId: string, notePath: string): Promise<string | null> {
  try {
    const raw = await fsService.readText(kbId, notePath);
    const id = `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    snapshotStore.set(id, { kbId, notePath, raw, at: Date.now() });
    pruneSnapshots();
    return id;
  } catch {
    return null;
  }
}

/** 按快照恢复笔记内容（回滚） */
export async function restoreSnapshot(snapshotId: string): Promise<{ ok: boolean; message: string }> {
  pruneSnapshots();
  const s = snapshotStore.get(snapshotId);
  if (!s) return { ok: false, message: '回滚快照已过期或不存在' };
  try {
    await fsService.writeText(s.kbId, s.notePath, s.raw);
    await fsService.syncIndex(s.kbId, s.notePath);
    auditService.record(s.kbId, 'aiPatch', { notePath: s.notePath, snapshotId, rollback: true, by: 'user' });
    snapshotStore.delete(snapshotId);
    return { ok: true, message: `已回滚到修改前：${s.notePath}` };
  } catch (e) {
    return { ok: false, message: `回滚失败：${String(e)}` };
  }
}

/**
 * 执行后验证：回读笔记，逐条校验 Patch 是否真的生效。
 * 未达预期时渲染层可提示用户回滚。
 */
export async function verifyPatch(
  kbId: string,
  notePath: string,
  ops: NotePatchOp[]
): Promise<{ ok: boolean; message: string }> {
  const note = await fsService.readNote(kbId, notePath).catch(() => null);
  if (!note) return { ok: false, message: `读取笔记失败：${notePath}` };
  const body = note.content;
  const fm = (note.frontmatter || {}) as Record<string, unknown>;

  for (const op of ops) {
    switch (op.op) {
      case 'replace':
        if (op.oldText && body.includes(op.oldText)) {
          return { ok: false, message: '被替换的原文仍然存在，替换可能未生效' };
        }
        if (op.newText?.trim() && !body.includes(op.newText.trim().slice(0, 200))) {
          return { ok: false, message: '新内容未出现在笔记中，替换可能未生效' };
        }
        break;
      case 'append':
        if (op.text?.trim() && !body.trimEnd().endsWith(op.text.trim())) {
          return { ok: false, message: '追加内容未出现在笔记末尾' };
        }
        break;
      case 'insert_after':
        if (op.text?.trim() && !body.includes(op.text.trim())) {
          return { ok: false, message: '插入内容未出现在笔记中' };
        }
        break;
      case 'set_frontmatter':
        if (op.key && JSON.stringify(fm[op.key]) !== JSON.stringify(op.value)) {
          return { ok: false, message: `frontmatter 字段 ${op.key} 未更新为目标值` };
        }
        break;
      case 'delete_lines':
        // 删除后无法用内容特征反查，跳过精确校验
        break;
    }
  }
  return { ok: true, message: '修改已生效' };
}
