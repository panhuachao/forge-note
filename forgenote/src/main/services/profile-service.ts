// 用户画像服务（doc/用户画像实现方案.md §7.1 / §4.3）
// 持久化：
//  - 知识库级：<kb.rootPath>/.forge/user-profile.json（完整画像）
//  - App 级底：app_config['user:profile-base']（新建知识库时作为初始画像底）
import { promises as fs } from 'fs';
import path from 'path';
import { getKB, getConfig, setConfig } from './store';
import {
  DEFAULT_PROFILE,
  PROFILE_VERSION,
  type UserProfile,
  type ProfileUpdate,
  type ProfileExtractResult,
  type ProfileTopic,
  type ProfileAuditEntry,
  type TopicSource
} from '@shared/types/profile';

const KB_PROFILE_FILE = path.join('.forge', 'user-profile.json');
const APP_BASE_KEY = 'user:profile-base';

/** 半衰期（天）：interests / recentFocus 权重随时间衰减 */
const HALF_LIFE_DAYS = 30;

function nowMs(): number {
  return Date.now();
}

function emptyProfile(): UserProfile {
  return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
}

function decayFactor(ts: number, halfLifeDays = HALF_LIFE_DAYS): number {
  const days = (nowMs() - ts) / 86_400_000;
  if (days <= 0) return 1;
  return Math.pow(0.5, days / halfLifeDays);
}

/** 用户画像服务单例（与 aiService 一致使用方式） */
export const profileService = {
  getProfile,
  mergeExtract,
  saveProfile,
  resetProfile,
  renderProfileBlock
};

function getAppBase(): Partial<UserProfile> {
  return (getConfig<UserProfile>(APP_BASE_KEY) as Partial<UserProfile>) || {};
}

/** 读取知识库级画像文件（可能不存在） */
async function readKbFile(kbId: string): Promise<UserProfile | null> {
  const kb = getKB(kbId);
  if (!kb) return null;
  try {
    const raw = await fs.readFile(path.join(kb.rootPath, KB_PROFILE_FILE), 'utf-8');
    const p = JSON.parse(raw) as UserProfile;
    if (!p || typeof p !== 'object' || !Array.isArray(p.interests)) return null;
    return p;
  } catch {
    return null;
  }
}

/** 合并 App 级底 + 知识库级文件：kb 级覆盖 app 级 */
export async function getProfile(kbId: string): Promise<UserProfile> {
  const base = getAppBase();
  const kb = await readKbFile(kbId);
  if (!kb) {
    const merged = { ...emptyProfile(), ...base, version: PROFILE_VERSION } as UserProfile;
    if (!merged.basics) merged.basics = {};
    if (!merged.preferences) merged.preferences = DEFAULT_PROFILE.preferences;
    if (!merged.interests) merged.interests = [];
    return merged;
  }
  return { ...emptyProfile(), ...base, ...kb, version: PROFILE_VERSION } as UserProfile;
}

async function writeKbFile(kbId: string, profile: UserProfile): Promise<void> {
  const kb = getKB(kbId);
  if (!kb) return;
  const dir = path.join(kb.rootPath, '.forge');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'user-profile.json'), JSON.stringify(profile, null, 2), 'utf-8');
}

/** 衰减 interests / recentFocus 权重，长期不提的主题自然淡出 */
function applyDecay(p: UserProfile): void {
  for (const t of p.interests) {
    t.weight = Math.max(0, t.weight * decayFactor(t.lastSeen));
  }
  p.interests = p.interests.filter((t) => t.weight >= 0.02);
  p.interests.sort((a, b) => b.weight - a.weight);

  for (const r of p.recentFocus) {
    r.weight = Math.max(0, r.weight * decayFactor(r.ts));
    if (r.weight < 0.02) r.decayed = true;
  }
  p.recentFocus = p.recentFocus.filter((r) => r.weight >= 0.02);
}

function pushAudit(p: UserProfile, entries: ProfileAuditEntry[]): void {
  p.audit.push(...entries);
  if (p.audit.length > 200) p.audit = p.audit.slice(-200);
}

/** 应用单个 ProfileUpdate 增量 */
function applyUpdate(p: UserProfile, u: ProfileUpdate): void {
  switch (u.field) {
    case 'basics':
      p.basics = { ...p.basics, ...(u.value as object) };
      break;
    case 'preferences':
      p.preferences = { ...p.preferences, ...(u.value as object) };
      break;
    case 'persona':
      if (typeof u.value === 'string') p.persona = u.value;
      break;
    case 'expertise':
      p.expertise = { ...p.expertise, ...(u.value as Record<string, number>) };
      break;
    case 'interests': {
      const incoming = (u.value as { name: string; weight?: number; evidence?: string; source?: TopicSource }[]) || [];
      for (const inc of incoming) {
        const exist = p.interests.find((t) => t.name === inc.name);
        const ts = nowMs();
        if (exist) {
          exist.weight = Math.min(1, exist.weight + (inc.weight ?? 0.15));
          exist.lastSeen = ts;
          if (inc.evidence) exist.evidence = inc.evidence;
          if (inc.source) exist.source = inc.source;
        } else {
          p.interests.push({
            name: inc.name,
            weight: Math.min(1, inc.weight ?? 0.3),
            firstSeen: ts,
            lastSeen: ts,
            evidence: inc.evidence || '',
            source: inc.source || 'chat'
          } as ProfileTopic);
        }
      }
      break;
    }
    case 'recentFocus': {
      const incoming = (u.value as { topic: string; weight?: number }[]) || [];
      for (const inc of incoming) {
        const exist = p.recentFocus.find((r) => r.topic === inc.topic);
        const ts = nowMs();
        if (exist) {
          exist.weight = Math.min(1, exist.weight + (inc.weight ?? 0.2));
          exist.ts = ts;
          exist.decayed = false;
        } else {
          p.recentFocus.push({ topic: inc.topic, weight: inc.weight ?? 0.3, ts, decayed: false });
        }
      }
      break;
    }
    case 'goals': {
      const goals = (u.value as string[]) || [];
      const set = new Set([...(p.basics.goals || []), ...goals]);
      p.basics.goals = Array.from(set);
      break;
    }
  }
}

/** 合并抽取结果（阶段 B 调用） */
export async function mergeExtract(kbId: string, result: ProfileExtractResult, skill: string): Promise<UserProfile> {
  const p = await getProfile(kbId);
  applyDecay(p);
  const audit: ProfileAuditEntry[] = [];
  for (const u of result.updates) {
    applyUpdate(p, u);
    audit.push({
      ts: nowMs(),
      skill,
      field: `${u.field}.${u.op}`,
      delta: JSON.stringify(u.value).slice(0, 200),
      confidenceDelta: result.confidence
    });
  }
  if (result.personaPatch && !p.persona.includes(result.personaPatch)) {
    p.persona = p.persona ? `${p.persona}\n${result.personaPatch}` : result.personaPatch;
  }
  pushAudit(p, audit);
  // 整体置信度滚动平均
  p.confidence = Math.min(1, p.confidence * 0.7 + result.confidence * 0.3);
  p.updatedAt = nowMs();
  p.interests.sort((a, b) => b.weight - a.weight);
  await writeKbFile(kbId, p);
  return p;
}

/** 手动修正（阶段 A 只读面板 + 阶段 C 接管）：最高优先级，直接覆盖 */
export async function saveProfile(kbId: string, profile: UserProfile): Promise<UserProfile> {
  const p: UserProfile = { ...emptyProfile(), ...profile, version: PROFILE_VERSION, updatedAt: nowMs() };
  await writeKbFile(kbId, p);
  return p;
}

/** 重置（清空）知识库级画像 */
export async function resetProfile(kbId: string): Promise<UserProfile> {
  const p = emptyProfile();
  await writeKbFile(kbId, p);
  return p;
}

/** 把画像渲染为注入 system 提示词的文本块（§5.1） */
export function renderProfileBlock(p: UserProfile): string {
  if (!p || p.confidence <= 0) return '';
  const lines: string[] = [];
  lines.push('【用户画像 · 长期上下文】');
  if (p.basics.role) lines.push(`- 身份：${p.basics.role}`);
  if (p.basics.domains?.length) lines.push(`- 长期关注领域：${p.basics.domains.join('、')}`);
  if (p.basics.goals?.length) lines.push(`- 当前目标：${p.basics.goals.join('、')}`);
  const pref = p.preferences;
  lines.push(
    `- 协作偏好：风格=${pref.tone}，深度=${pref.depth}，主动度=${pref.proactivity}，` +
      `引用来源=${pref.citeSources ? '要求' : '不要求'}，结构化=${pref.preferStructured ? '偏好' : '不偏好'}`
  );
  if (p.interests.length) {
    const top = p.interests.slice(0, 8).map((t) => `${t.name}(${t.weight.toFixed(2)})`);
    lines.push(`- 兴趣主题：${top.join('、')}`);
  }
  if (p.recentFocus.length) {
    const top = p.recentFocus.slice(0, 5).map((r) => r.topic);
    lines.push(`- 近期聚焦：${top.join('、')}`);
  }
  const exp = Object.entries(p.expertise).filter(([, v]) => v > 0);
  if (exp.length) lines.push(`- 领域熟练度：${exp.map(([k, v]) => `${k}=${v}`).join('、')}`);
  if (p.persona) lines.push(`- 用户画像简述：${p.persona}`);
  lines.push('（以上为你的长期记忆，请在回答中自然运用，不要显式复述"根据您的画像"）');
  return lines.join('\n');
}
