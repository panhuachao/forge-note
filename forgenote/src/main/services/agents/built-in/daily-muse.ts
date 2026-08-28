// 内置 Agent：灵光一现（方案 §3.3 / §3.6，解决"每天都是同样反馈"）
import type { AgentProfile, AgentRunCtx } from '../types';
import { recentInspirationPrompt, appendInspiration } from '../inspire-history';

const BANNED_MOTHES = [
  '拖延', '习惯', '自律', '专注', '冥想', '5分钟启动', '第一性原理', '心流',
  '刻意练习', '复盘', '时间管理', '番茄钟', '先做难事', '先完成再完美', '成长型思维'
];

export const dailyMuse: AgentProfile = {
  id: 'daily-muse',
  title: '灵光一现',
  description: '每天给用户一个出其不意、跨界的认知火花，绝不重复昨日角度。',
  systemPrompt: `你是锦囊笔记的「灵光一现」引擎。每天，给用户**一个**出其不意、能点亮一天的认知火花。

# 角色
- 你不写长文、不做总结。你只给一个"醍醐灌顶、可执行"的认知钩子。
- 你不是「心灵鸡汤作者」。**严禁**使用如下母题——一旦想到就立刻换一个完全不同的领域（物理、生物、人类学、艺术、复杂系统、博弈论……）：
  ${BANNED_MOTHES.map((m) => `「${m}」`).join('、')}
- 你偏好**跨界**：从一个用户主业之外的领域，桥接回他的知识库或近期聚焦。

# 输出结构（极简，≤ 120 字）
- 一句话钩子（< 25 字，反常识 / 反直觉）
- 为什么意外（1 句，点出跨界支点）
- 一个今天就能做的小动作（具体、可落地）

# 风格
- 不抒情、不鼓励、不"加油"。
- 不要复述近期已生成的灵感（系统会注入，请规避）。
- 若用户知识库极空 / 画像置信度 < 0.3，改为问用户 3 个聚焦问题，而非强行生成。`,
  sampling: { temperature: 0.9, top_p: 1, presence_penalty: 0.7, frequency_penalty: 0.4 },
  retrieval: { enabled: true, topK: 4, includeDirTree: false, includeOrphans: false },
  profileFields: ['interests', 'recentFocus'],
  extraSystem: (ctx: AgentRunCtx) => {
    const kbId = ctx.kbId;
    return kbId ? recentInspirationPrompt(kbId) : '';
  },
  postRun: async (ctx, result) => {
    if (!ctx.kbId) return;
    const hook = result.text.split('\n')[0].replace(/^[-*\d.、\s]+/, '').slice(0, 40);
    appendInspiration(ctx.kbId, {
      ts: Date.now(),
      agentId: 'daily-muse',
      angles: [hook || result.text.slice(0, 40)]
    });
  }
};
