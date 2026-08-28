// 多 Agent 抽象：专家角色契约（方案 §3.1）
import type { TreeNode, KBProfile } from '@shared/types';

/** 采样参数（覆盖全局默认，方案 §3.1） */
export interface AgentSampling {
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_tokens?: number;
}

/** RAG 召回策略（方案 §3.1 / §4.4） */
export interface AgentRetrieval {
  enabled: boolean;
  topK?: number;
  /** 召回权重（仅语义检索时起作用） */
  weight?: { title?: number; tag?: number; content?: number; orphan?: number };
  /** 是否需要目录树上下文 */
  includeDirTree?: boolean;
  /** 是否需要"知识库缝隙"上下文（孤立节点、低频主题） */
  includeOrphans?: boolean;
}

/** 用户画像字段权重（哪些画像字段需要被注入到 sys） */
export type ProfileField = 'basics' | 'interests' | 'preferences' | 'recentFocus' | 'longTerm';

/** Agent 运行上下文（preRun/postRun 可用） */
export interface AgentRunCtx {
  kbId?: string;
  input: Record<string, unknown>;
  history?: unknown[];
  skill?: unknown;
  /** 额外透传（如 inspirer 的 mode） */
  extra?: Record<string, unknown>;
  /** 回调：用于记录用量 / 埋点 */
  onUsage?: (usage: { promptTokens: number; completionTokens: number; ms: number }) => void;
}

export interface AgentRunResult {
  kind: 'text' | 'structured';
  text: string;
  data?: unknown;
}

/** 内置 Agent 定义（完整人格，方案 §3.1 / §4.6.1） */
export interface AgentProfile {
  id: string;
  title: string;
  description: string;
  /** 人格 / 角色 / 输出结构的 system prompt（不含 RAG 上下文） */
  systemPrompt: string;
  sampling?: AgentSampling;
  retrieval?: AgentRetrieval;
  /** 可用 MCP 工具名子集（agent 内部 ReAct 调用） */
  useTools?: string[];
  /** 用户画像字段权重 */
  profileFields?: ProfileField[];
  /** 附加指引（如灵感 Agent 的"近期已生成的灵感"），由 compose 注入 */
  extraSystem?: (ctx: AgentRunCtx) => string | Promise<string>;
  preRun?: (ctx: AgentRunCtx) => Promise<void>;
  postRun?: (ctx: AgentRunCtx, result: AgentRunResult) => Promise<void>;
}

/** 用户覆写结构（落库 app_config['ai:agents']，方案 §4.6.2） */
export interface AgentOverrides {
  [agentId: string]: {
    systemPrompt?: string;
    sampling?: Partial<AgentSampling>;
    retrieval?: Partial<AgentRetrieval>;
    profileFields?: ProfileField[];
    extraSystem?: string; // 用户覆写仅支持静态文本
  };
}

export interface KBTreeLike extends TreeNode {}
export type { KBProfile };
