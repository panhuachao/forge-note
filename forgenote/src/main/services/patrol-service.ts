// 知识库巡检服务（doc/AI智能管家重构方案.md §5.2 P2-1）
//
// 定位：让 AI 从「被动问答工具」迈出主动管家的第一步——
// 无需用户发起，定期扫描知识库，发现健康问题并给出**可一键执行的整理建议**。
//
// 关键降级原则：**规则类检查项完全不依赖模型**。
// 失效链接、重复内容、孤儿笔记、空目录、稀疏标签、结构、过期内容
// 全部由本地规则算出；只有「让 AI 解读报告并补充建议」才需要模型。
// 这样即使未配置 AI，管家仍能完成基础体检。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getKB } from './store';
import { linkIndex } from './link-index';
import { scanNotes } from './tool-runtime';
import { versionService } from './version-service';
import type {
  BatchPatchPayload,
  ConfirmableAction,
  NotePatchOp,
  PatrolCategory,
  PatrolFinding,
  PatrolReport,
  PatrolSeverity
} from '@shared/types/ai';

// 类型统一定义在 @shared/types/ai，供渲染层直接引用（避免渲染层反向依赖主进程代码）
export type { PatrolCategory, PatrolFinding, PatrolReport, PatrolSeverity };

/** 报告缓存有效期（毫秒）：默认 24 小时 */
const CACHE_TTL = 24 * 3600_000;
/** 同一条建议的静默期：7 天（P2-5 主动建议节流） */
const SUGGEST_COOLDOWN = 7 * 24 * 3600_000;
/** 单次最多推送的建议条数 */
const MAX_SUGGEST_PER_ROUND = 3;

const CATEGORY_LABEL: Record<PatrolCategory, string> = {
  'broken-link': '失效双链',
  duplicate: '重复内容',
  orphan: '孤立笔记',
  'empty-dir': '空目录',
  'sparse-tag': '稀疏标签',
  structure: '目录结构',
  stale: '长期未更新',
  'version-size': '版本占用'
};

let seq = 0;
const genId = () => `pf_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function patrolDir(kbId: string): string | null {
  try {
    const kb = getKB(kbId);
    return kb ? path.join(kb.rootPath, '.forge', 'patrol') : null;
  } catch {
    return null;
  }
}

function reportFile(kbId: string): string | null {
  const dir = patrolDir(kbId);
  return dir ? path.join(dir, 'report.json') : null;
}

/** 已展示建议的记录文件：{ [dedupeKey]: lastShownAt } */
function shownFile(kbId: string): string | null {
  const dir = patrolDir(kbId);
  return dir ? path.join(dir, 'shown.json') : null;
}

function readShown(kbId: string): Record<string, number> {
  const file = shownFile(kbId);
  if (!file || !fs.existsSync(file)) return {};
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, number>) ?? {};
  } catch {
    return {};
  }
}

function writeShown(kbId: string, data: Record<string, number>): void {
  const file = shownFile(kbId);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data), 'utf-8');
  } catch {
    /* 记录失败不影响主流程 */
  }
}

/**
 * 取待推送的主动建议（P2-5）。
 * 规则：只推 high / medium，且同一 dedupeKey 在静默期内不重复推送，单轮最多 3 条。
 */
export function getPendingSuggestions(kbId: string): PatrolFinding[] {
  const report = getCachedReport(kbId);
  if (!report?.findings?.length) return [];
  const shown = readShown(kbId);
  const now = Date.now();
  return report.findings
    .filter((f) => f.severity !== 'low')
    .filter((f) => !(shown[f.dedupeKey] && now - shown[f.dedupeKey] < SUGGEST_COOLDOWN))
    .slice(0, MAX_SUGGEST_PER_ROUND);
}

/** 标记建议已展示（写入静默期起点） */
export function markSuggestionsShown(kbId: string, dedupeKeys: string[]): void {
  if (!dedupeKeys.length) return;
  const shown = readShown(kbId);
  const now = Date.now();
  for (const k of dedupeKeys) shown[k] = now;
  writeShown(kbId, shown);
}

/** 读取缓存报告（未过期才返回） */
export function getCachedReport(kbId: string): PatrolReport | null {
  const file = reportFile(kbId);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf-8')) as PatrolReport;
    if (!r?.at || Date.now() - r.at > CACHE_TTL) return null;
    return r;
  } catch {
    return null;
  }
}

/**
 * 执行巡检。
 * @param force 为 true 时忽略缓存重新扫描；否则 24h 内直接返回缓存。
 */
export async function runPatrol(kbId: string, force = false): Promise<PatrolReport> {
  if (!force) {
    const cached = getCachedReport(kbId);
    if (cached) return cached;
  }

  const notes = scanNotes(kbId);
  const findings: PatrolFinding[] = [];

  const kb = getKB(kbId);
  if (!kb) throw new Error('知识库不存在');

  /* ---------- 统计 ---------- */
  const dirSet = new Set<string>();
  const tagCounter = new Map<string, number>();
  let linkCount = 0;
  let untagged = 0;
  for (const n of notes) {
    if (n.dir) dirSet.add(n.dir);
    if (!n.tags.length) untagged++;
    for (const t of n.tags) tagCounter.set(t, (tagCounter.get(t) || 0) + 1);
    linkCount += n.outlinks.length;
  }

  /* ---------- 1) 失效双链（高）---------- */
  const brokenByNote = new Map<string, string[]>();
  let brokenLinkCount = 0;
  for (const n of notes) {
    const broken = n.outlinks.filter((t) => !linkIndex.resolve(kbId, t));
    if (broken.length) {
      brokenByNote.set(n.path, broken);
      brokenLinkCount += broken.length;
    }
  }
  if (brokenLinkCount > 0) {
    const affected = Array.from(brokenByNote.keys());
    findings.push({
      id: genId(),
      severity: 'high',
      category: 'broken-link',
      title: `发现 ${brokenLinkCount} 处失效双链`,
      detail: `${affected.length} 篇笔记引用了不存在的笔记。可一键取消链接标记（保留文字，不删内容）。`,
      affected: affected.slice(0, 50),
      dedupeKey: `broken-link:${brokenLinkCount}`,
      suggestion: buildUnlinkAction(brokenByNote)
    });
  }

  /* ---------- 2) 重复内容（中）---------- */
  const byTitle = new Map<string, string[]>();
  for (const n of notes) {
    const key = n.title.trim().toLowerCase();
    if (!key) continue;
    const list = byTitle.get(key);
    if (list) list.push(n.path);
    else byTitle.set(key, [n.path]);
  }
  const dupGroups = Array.from(byTitle.values()).filter((ps) => ps.length > 1);
  if (dupGroups.length) {
    const affected = dupGroups.flat();
    findings.push({
      id: genId(),
      severity: 'medium',
      category: 'duplicate',
      title: `发现 ${dupGroups.length} 组同名笔记`,
      detail: '标题完全相同的笔记可能是重复记录，建议核对后合并或重命名。',
      affected: affected.slice(0, 50),
      dedupeKey: `duplicate:${dupGroups.length}`
    });
  }

  /* ---------- 3) 孤立笔记（中）---------- */
  const orphans = notes.filter((n) => n.outlinks.length === 0 && n.inlinks.length === 0 && n.tags.length === 0);
  if (orphans.length) {
    findings.push({
      id: genId(),
      severity: 'medium',
      category: 'orphan',
      title: `${orphans.length} 篇孤立笔记未融入知识体系`,
      detail: '这些笔记既没有双链也没有标签，几乎无法被检索到。建议补充标签或建立双链。',
      affected: orphans.map((n) => n.path).slice(0, 50),
      dedupeKey: `orphan:${orphans.length}`
    });
  }

  /* ---------- 4) 空目录（低）---------- */
  const emptyDirs: string[] = [];
  const walkEmpty = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(kb.rootPath, dir), { withFileTypes: true });
    } catch {
      return;
    }
    const subDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'));
    if (!files.length && !subDirs.length && dir) {
      emptyDirs.push(dir);
      return;
    }
    for (const d of subDirs) walkEmpty(dir ? `${dir}/${d.name}` : d.name);
  };
  walkEmpty('');
  if (emptyDirs.length) {
    findings.push({
      id: genId(),
      severity: 'low',
      category: 'empty-dir',
      title: `${emptyDirs.length} 个空目录`,
      detail: '空目录会让目录树变得杂乱，建议清理或移入笔记。',
      affected: emptyDirs.slice(0, 30),
      dedupeKey: `empty-dir:${emptyDirs.length}`
    });
  }

  /* ---------- 5) 稀疏标签（低）---------- */
  const sparseTags = Array.from(tagCounter.entries())
    .filter(([, c]) => c === 1)
    .map(([t]) => t);
  if (sparseTags.length >= 5) {
    findings.push({
      id: genId(),
      severity: 'low',
      category: 'sparse-tag',
      title: `${sparseTags.length} 个标签只被使用过一次`,
      detail: '过多一次性标签会稀释标签体系的价值，建议合并到相近标签。',
      affected: sparseTags.slice(0, 30),
      dedupeKey: `sparse-tag:${sparseTags.length}`
    });
  }

  /* ---------- 6) 目录结构（低）---------- */
  const dirList = Array.from(dirSet);
  const maxDepth = dirList.reduce((m, d) => Math.max(m, d.split('/').length), 0);
  const rootNotes = notes.filter((n) => !n.dir).length;
  if (maxDepth >= 4 || rootNotes >= 10) {
    const detail = [
      maxDepth >= 4 ? `目录最深 ${maxDepth} 层，过深会影响查找` : '',
      rootNotes >= 10 ? `根目录散落 ${rootNotes} 篇笔记，建议归入分类目录` : ''
    ]
      .filter(Boolean)
      .join('；');
    findings.push({
      id: genId(),
      severity: 'low',
      category: 'structure',
      title: '目录结构可以优化',
      detail,
      affected: notes.filter((n) => !n.dir).map((n) => n.path).slice(0, 30),
      dedupeKey: `structure:${maxDepth}:${rootNotes}`
    });
  }

  /* ---------- 7) 长期未更新（低）---------- */
  const staleTs = Date.now() - 180 * 86400_000;
  const stale = notes.filter((n) => n.mtime > 0 && n.mtime < staleTs);
  if (stale.length) {
    findings.push({
      id: genId(),
      severity: 'low',
      category: 'stale',
      title: `${stale.length} 篇笔记超过半年未更新`,
      detail: '长期未动的笔记可能已经过时，建议回顾、归档或补充最新信息。',
      affected: stale.map((n) => n.path).slice(0, 30),
      dedupeKey: `stale:${stale.length}`
    });
  }

  /* ---------- 8) 版本历史占用（低，仅提示不做自动动作）---------- */
  const versionBytes = await versionService.totalSize(kbId).catch(() => 0);
  // 仅在占用超过 32MB 时才提示，避免刚启用版本功能就打扰用户
  if (versionBytes > 32 * 1024 * 1024) {
    findings.push({
      id: genId(),
      severity: 'low',
      category: 'version-size',
      title: `版本历史占用 ${(versionBytes / 1024 / 1024).toFixed(1)} MB`,
      detail:
        '版本历史保存在 .forge/versions/ 下，会随编辑积累。系统已按「7 天内全保留 / 30 天内每天 1 份 / 更早每周 1 份」自动淘汰，如需立即释放空间可手动清理。',
      affected: [],
      dedupeKey: `version-size:${Math.round(versionBytes / (32 * 1024 * 1024))}`
    });
  }

  /* ---------- 健康分 ---------- */
  const score = calcScore({
    noteCount: notes.length,
    brokenLinkCount,
    orphanCount: orphans.length,
    untaggedCount: untagged,
    duplicateGroups: dupGroups.length,
    emptyDirCount: emptyDirs.length
  });

  const report: PatrolReport = {
    kbId,
    at: Date.now(),
    stats: {
      noteCount: notes.length,
      dirCount: dirSet.size,
      tagCount: tagCounter.size,
      linkCount,
      brokenLinkCount,
      orphanCount: orphans.length,
      untaggedCount: untagged
    },
    findings: findings.sort(
      (a, b) => severityWeight(b.severity) - severityWeight(a.severity)
    ),
    score
  };

  // 落盘缓存（失败不影响本次结果）
  const file = reportFile(kbId);
  if (file) {
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(report), 'utf-8');
    } catch {
      /* 缓存写失败忽略 */
    }
  }
  return report;
}

function severityWeight(s: PatrolSeverity): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

/** 健康分：从 100 起扣，各项按严重程度加权，最低 0 */
function calcScore(m: {
  noteCount: number;
  brokenLinkCount: number;
  orphanCount: number;
  untaggedCount: number;
  duplicateGroups: number;
  emptyDirCount: number;
}): number {
  if (!m.noteCount) return 100;
  let score = 100;
  // 失效链接和孤儿笔记占比越高扣得越多
  score -= Math.min(30, (m.brokenLinkCount / Math.max(1, m.noteCount)) * 60);
  score -= Math.min(25, (m.orphanCount / Math.max(1, m.noteCount)) * 50);
  score -= Math.min(15, (m.untaggedCount / Math.max(1, m.noteCount)) * 30);
  score -= Math.min(15, m.duplicateGroups * 3);
  score -= Math.min(10, m.emptyDirCount * 2);
  return Math.max(0, Math.round(score));
}

/**
 * 构造「取消失效双链」的批量修改建议。
 * 策略：把 [[目标]] 还原为纯文本（保留文字、只去掉链接语法），
 * 这样不会丢失任何内容，是最安全的自动修复方式。
 */
function buildUnlinkAction(brokenByNote: Map<string, string[]>): ConfirmableAction<BatchPatchPayload> {
  const items = Array.from(brokenByNote.entries()).map(([notePath, targets]) => {
    const ops: NotePatchOp[] = targets.map((t) => ({
      op: 'replace' as const,
      oldText: `[[${t}]]`,
      newText: t
    }));
    return { notePath, ops };
  });
  return {
    id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'batchPatch',
    title: `取消 ${items.length} 篇笔记中的失效双链`,
    description: '把失效的 [[链接]] 还原为纯文本，保留原有文字，不删除任何内容。',
    payload: { items }
  };
}

export { CATEGORY_LABEL };
