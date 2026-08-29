// 行级 diff 工具（doc/笔记版本实现方案.md §5.3）
//
// 从 note-patch.ts 上提而来：原本 makeUnifiedDiff 是 note-patch 的模块私有函数，
// 版本历史同样需要比对能力，因此抽到 utils 层供两处共用。
//
// 实现为经典 LCS 动态规划，无外部依赖。
// 超大文档（行数组合超过阈值）退化为「仅统计」，避免 O(n*m) 内存爆炸。

import type { DiffLine } from '@shared/types/version';

export type { DiffLine };

export type DiffOpType = ' ' | '-' | '+';

export interface DiffOp {
  type: DiffOpType;
  line: string;
}

/** 增删行数统计 */
export interface DiffStats {
  added: number;
  removed: number;
}

/** 超过该规模（行数组合）时跳过逐行 diff，仅返回统计 */
const MAX_CELLS = 4_000_000;

/** 计算 LCS 编辑脚本（ops 序列） */
function buildOps(before: string, after: string): { ops: DiffOp[]; tooLarge: boolean } {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_CELLS) {
    return { ops: [], tooLarge: true };
  }

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
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
  return { ops, tooLarge: false };
}

/**
 * 简易行级 unified diff 字符串（无外部依赖）。
 * 仅在变更行附近保留 context 行，中间以 `@@ ...` 标记间隔。
 */
export function makeUnifiedDiff(before: string, after: string, context = 2): string {
  const { ops, tooLarge } = buildOps(before, after);
  if (tooLarge) {
    return `（文档过大，已跳过逐行 diff；修改后共 ${after.split('\n').length} 行）`;
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

/**
 * 结构化 diff：供版本历史 UI 按行着色渲染。
 * 保留原始行号，跳过的区间以 `gap` 行标记。
 */
export function structuredDiff(before: string, after: string, context = 3): DiffLine[] {
  const { ops, tooLarge } = buildOps(before, after);
  if (tooLarge) {
    return [{ type: 'gap', text: `（文档过大，已跳过逐行 diff；修改后共 ${after.split('\n').length} 行）` }];
  }

  const keep = new Array<boolean>(ops.length).fill(false);
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type === ' ') continue;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  }

  const out: DiffLine[] = [];
  let last = -1;
  let oldNo = 0;
  let newNo = 0;
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx];
    // 行号在被跳过的区间也要累加，否则行号会错位
    if (op.type === ' ') {
      oldNo++;
      newNo++;
    } else if (op.type === '-') {
      oldNo++;
    } else {
      newNo++;
    }
    if (!keep[idx]) continue;
    if (last >= 0 && idx - last > 1) out.push({ type: 'gap', text: '⋯' });
    if (op.type === ' ') {
      out.push({ type: 'ctx', text: op.line, oldLineNo: oldNo, newLineNo: newNo });
    } else if (op.type === '-') {
      out.push({ type: 'del', text: op.line, oldLineNo: oldNo });
    } else {
      out.push({ type: 'add', text: op.line, newLineNo: newNo });
    }
    last = idx;
  }
  return out;
}

/** 统计增删行数（供版本元数据记录 delta） */
export function diffStats(before: string, after: string): DiffStats {
  const { ops, tooLarge } = buildOps(before, after);
  if (tooLarge) {
    const a = before.split('\n').length;
    const b = after.split('\n').length;
    return b >= a ? { added: b - a, removed: 0 } : { added: 0, removed: a - b };
  }
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === '+') added++;
    else if (op.type === '-') removed++;
  }
  return { added, removed };
}
