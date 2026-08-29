// Skill 声明类型（主进程与渲染进程共用）
//
// 原本定义在 src/main/services/skill-engine.ts，因插件系统需要让 shared 层引用
// （插件要注册 Skill），而 shared 不能反向依赖 main，故上提到 shared。
import type { AIResponse, AIRefHit, AIUsage, AITurn } from './ai';
import type { ToolActivity } from './mcp';

/** Skill 运行上下文（由 AIHub 注入） */
export interface AISkillCtx {
  kbId?: string;
  input: { text: string; question?: string; dirId?: string; notePath?: string; targets?: string[] };
  /** 已注入的多轮历史（stateful Skill 才有） */
  history: AITurn[];
  /** 会话草稿（awaitConfirm Skill 确认后回传） */
  pendingDraft?: unknown;
  onActivity?: (a: ToolActivity) => void;
  /** 多 Agent 方案：当前请求指定的 Agent 角色 */
  agentId?: string;
}

/** 统一 Skill 声明 */
export interface AISkill {
  id: string;
  title: string;
  description: string;
  /** 模型能力偏好（预留 ModelRouter） */
  capability?: ('reasoning' | 'long-context' | 'cheap')[];
  /** 需要跨轮上下文（AIHub 自动挂载 SessionStore） */
  stateful?: boolean;
  /** 首轮只产出 draft，确认后才执行写工具 */
  awaitConfirm?: boolean;
  /** 需要调用的 MCP 工具 id */
  useTools?: string[];
  /** 无模型时的本地降级 */
  localFallback?: (ctx: AISkillCtx) => AIResponse | Promise<AIResponse>;
  /** 实际执行 */
  run: (ctx: AISkillCtx) => Promise<AIResponse & { refs?: AIRefHit[]; usage?: AIUsage }>;
}
