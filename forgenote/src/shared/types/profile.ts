// 用户画像类型定义（doc/用户画像实现方案.md §2）
// 画像持久化位置：
//  - 知识库级：<kb>/.forge/user-profile.json（兴趣/领域/诊断结论，随知识库）
//  - App 级：app_config 的 'user:profile-base'（basics.name/language/timezone、preferences 默认偏好）
// 读取时 App 级为底，知识库级叠加覆盖；写回按归属落盘。

export type TopicSource = 'note-tag' | 'chat' | 'diagnose' | 'manual' | 'note-save';
export type Tone = 'concise' | 'detailed' | 'socratic' | 'casual';
export type Proactivity = 'passive' | 'balanced' | 'proactive';
export type Depth = 'intro' | 'intermediate' | 'expert';

export interface ProfileBasics {
  name?: string;
  role?: string;
  domains?: string[];
  goals?: string[];
  timezone?: string;
  language?: string;
}

export interface ProfileTopic {
  name: string;
  weight: number; // 0~1 关注度
  firstSeen: number;
  lastSeen: number;
  evidence: string;
  source: TopicSource;
}

export interface CollaborationPreference {
  tone: Tone;
  proactivity: Proactivity;
  depth: Depth;
  citeSources: boolean;
  autoSummarize: boolean;
  preferStructured: boolean;
}

export interface RecentFocusEntry {
  topic: string;
  weight: number;
  ts: number;
  decayed: boolean;
}

export interface ProfileAuditEntry {
  ts: number;
  skill: string;
  field: string;
  delta: string;
  confidenceDelta: number;
}

export interface UserProfile {
  version: number;
  basics: ProfileBasics;
  interests: ProfileTopic[];
  persona: string;
  preferences: CollaborationPreference;
  expertise: Record<string, number>; // 领域 -> 0~5
  recentFocus: RecentFocusEntry[];
  audit: ProfileAuditEntry[];
  confidence: number; // 0~1
  updatedAt: number;
}

// 画像更新增量（抽取 Skill 产出 / 手动修正产出）
export interface ProfileUpdate {
  field: 'basics' | 'interests' | 'persona' | 'preferences' | 'expertise' | 'recentFocus' | 'goals';
  op: 'set' | 'add' | 'merge' | 'patch';
  value: unknown;
}

export interface ProfileExtractResult {
  updates: ProfileUpdate[];
  personaPatch?: string;
  confidence: number; // 本次抽取置信度 0~1
}

// 知识库级画像文件（落在 <kb>/.forge/user-profile.json）
export type KbProfile = UserProfile;

export const PROFILE_VERSION = 1;

export const DEFAULT_PROFILE: UserProfile = {
  version: PROFILE_VERSION,
  basics: {},
  interests: [],
  persona: '',
  preferences: {
    tone: 'detailed',
    proactivity: 'balanced',
    depth: 'intermediate',
    citeSources: true,
    autoSummarize: false,
    preferStructured: true
  },
  expertise: {},
  recentFocus: [],
  audit: [],
  confidence: 0,
  updatedAt: 0
};
