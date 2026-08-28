// 按 AgentProfile.retrieval 调 retrieve() 的薄封装（方案 §3.1 / §4.3.2）
import type { AgentRetrieval, AgentRunCtx } from './types';
import { aiService } from '../ai-service';

/** 构建该 Agent 需要的知识库上下文（空字符串表示不检索） */
export async function buildAgentRetrieval(kbId: string | undefined, question: string, retrieval?: AgentRetrieval): Promise<string> {
  if (!retrieval?.enabled || !kbId) return '';
  return aiService.buildRetrievalContext(kbId, question, {
    enabled: true,
    topK: retrieval.topK ?? 12,
    includeDirTree: retrieval.includeDirTree,
    includeOrphans: retrieval.includeOrphans
  });
}
