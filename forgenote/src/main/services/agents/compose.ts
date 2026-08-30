// 拼接最终 system prompt（方案 §3.4 / §4.2 / §4.6 原则）
import type { AgentProfile, AgentRunCtx } from './types';
import { profileService } from '../profile-service';
import { buildAgentRetrieval } from './retrieval';

/** 把 Agent 人格 / 画像 / 检索 / 附加指引 / 行为边界拼接成最终 sys（人格在前，后续被人格"着色"） */
export async function composeAgentSystem(agent: AgentProfile, ctx: AgentRunCtx): Promise<string> {
  const blocks: string[] = [];

  // 1) Agent 人格（核心）
  blocks.push(agent.systemPrompt);

  // 2) 用户画像（按 profileFields 过滤）
  if (ctx.kbId && agent.profileFields) {
    try {
      const p = await profileService.getProfile(ctx.kbId);
      const block = profileService.renderProfileBlock(p, agent.profileFields);
      if (block) blocks.push(block);
    } catch {
      /* 画像失败不影响主对话 */
    }
  }

  // 3) 知识库检索上下文
  if (agent.retrieval?.enabled && ctx.kbId) {
    const question = String(ctx.input.text ?? ctx.input.question ?? '');
    const rag = await buildAgentRetrieval(ctx.kbId, question, agent.retrieval);
    if (rag) blocks.push(`# 知识库上下文\n${rag}`);
  }

  // 4) Agent 附加指引（如灵感 Agent 的"近期已生成灵感"）
  if (agent.extraSystem) {
    const extra = await agent.extraSystem(ctx);
    if (extra) blocks.push(extra);
  }

  // 5) 全局行为边界（事实 / 安全约束）
  blocks.push(
    '# 行为边界\n' +
      '- 所有引用必须基于上方提供的知识库内容，不编造未出现的笔记或数据。\n' +
      '- 优先使用本地资料回答；若用户请求分析、延伸、对比等任务而本地资料不足，可结合通用知识进行合理推演与补充，但须明确区分本地资料与通用知识推断，并提醒用户核实关键数据。\n' +
      '- 保持对用户的尊重与专业，不输出违规内容。'
  );

  return blocks.join('\n\n');
}
