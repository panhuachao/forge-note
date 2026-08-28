// 灵感历史持久化与读取（方案 §3.6 / §4.4 / §4.6.4）
// 按 KB 隔离，落在 <kbRoot>/.forge/inspiration-history.json（非 frontmatter、非 app_config）
import fs from 'fs';
import path from 'path';
import { getKB } from '../store';

const HISTORY_FILE = path.join('.forge', 'inspiration-history.json');
const MAX_RECORDS = 60;

export interface InspirationRecord {
  ts: number;
  agentId: 'daily-muse' | 'inspirer';
  mode?: string;
  /** 每条灵感的"一句话钩子"，用于去重比对 */
  angles: string[];
}

function readHistory(kbId: string): InspirationRecord[] {
  const kb = getKB(kbId);
  if (!kb) return [];
  try {
    const raw = fs.readFileSync(path.join(kb.rootPath, HISTORY_FILE), 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeHistory(kbId: string, records: InspirationRecord[]): void {
  const kb = getKB(kbId);
  if (!kb) return;
  try {
    const dir = path.join(kb.rootPath, '.forge');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'inspiration-history.json'), JSON.stringify(records.slice(-MAX_RECORDS), null, 2), 'utf-8');
  } catch {
    /* 静默忽略，不阻断 Agent */
  }
}

/** 读取最近 days 天 / 最多 limit 条的"近期已生成灵感"文本，注入 sys 的"避免重复区" */
export function recentInspirationPrompt(kbId: string, days = 7, limit = 10): string {
  if (!kbId) return '';
  const recs = readHistory(kbId);
  if (recs.length === 0) return '';
  const cutoff = Date.now() - days * 86400_000;
  const recent = recs.filter((r) => r.ts >= cutoff).slice(-limit);
  if (recent.length === 0) return '';
  const lines = recent.map((r) => {
    const d = new Date(r.ts).toISOString().slice(0, 10);
    return `- ${d}: ${r.angles.join(' / ')}`;
  });
  return `# 近期已生成的灵感（请避免重复这些角度）\n${lines.join('\n')}`;
}

/** 追加一条灵感记录（postRun 调用） */
export function appendInspiration(kbId: string, rec: InspirationRecord): void {
  if (!kbId) return;
  const cur = readHistory(kbId);
  cur.push(rec);
  writeHistory(kbId, cur);
}
