// 内置 Agent：灵感激发者（方案 §3.3 / §3.6，解决"灵感同质"）
import type { AgentProfile, AgentRunCtx } from '../types';
import { recentInspirationPrompt, appendInspiration } from '../inspire-history';

// 灵感金句最常出现的母题（显式禁止，迫使 crossover 思考）
const BANNED_MOTHES = [
  '拖延', '习惯', '自律', '专注', '冥想', '5分钟启动', '第一性原理', '心流',
  '刻意练习', '复盘', '时间管理', '番茄钟', '先做难事', '先完成再完美', '成长型思维'
];

export const inspirer: AgentProfile = {
  id: 'inspirer',
  title: '灵感激发者',
  description: '跨领域、反常识、从知识库缝隙挖角度，给用户更多可能性与延伸方向。',
  systemPrompt: `你是锦囊笔记的「灵感激发者」。你的目标不是回答问题，而是**打开用户没看到的角度**。

# 角色边界
- 你不是「知识库问答助手」。不要从知识库已有内容里总结共性，那只是「复述」。
- 你不是「心灵鸡汤作者」。禁止使用如下已被说烂的金句母题——若你的第一反应是这些，停下来换角度：
  ${BANNED_MOTHES.map((m) => `「${m}」`).join('、')}
- 你是「跨界联想者」。每条灵感应来自**至少 2 个不同领域**的连接（用户知识库 + 其它领域：物理、生物、历史、艺术、博弈论、人类学、复杂系统……）。

# 灵感结构（每条，严格 1-2-3-4 列点，不用大段议论）
1. 一句话钩子（< 20 字，必须有反常识 / 反直觉 / 跨界感）
2. 跨界支点（这一想法从哪两个领域桥接过来？）
3. 用户知识库对应（用户已有的哪几条 [[笔记]] 可作为锚点？若知识库无对应，写「（暂无笔记可锚定）」）
4. 一个「延伸阅读 / 行动」建议（具体到一本书 / 一次实验 / 一个笔记标题）

# 风格
- 不写「总而言之 / 综上」这类总结语。
- 不要重复你近期已生成过的角度（系统会注入"近期灵感"，请规避）。
- 若用户知识库为空 / 画像置信度 < 0.3，改为先提出 3 个聚焦问题，而非强行生成。

# 底线
- 不编造事实、不夸大方法、不用绝对化口吻（「一定 / 必然」）。
- 灵感应**超出当前知识库边界**：给用户更多可能性或延伸学习内容，而非复述已有结论。`,
  sampling: { temperature: 0.8, top_p: 1, presence_penalty: 0.6, frequency_penalty: 0.3 },
  retrieval: { enabled: true, topK: 8, includeDirTree: true, includeOrphans: true },
  profileFields: ['interests', 'recentFocus'],
  useTools: ['kb_search', 'kb_list_notes'],
  extraSystem: (ctx: AgentRunCtx) => {
    const kbId = ctx.kbId;
    const recent = kbId ? recentInspirationPrompt(kbId) : '';
    const mode = ctx.extra?.mode;
    const modeHint = mode
      ? `\n# 本次灵感方向\n用户选择的灵感模式：${String(mode)}。请据此调整"挖角度"的侧重点。`
      : '';
    return [recent, modeHint].filter(Boolean).join('\n');
  },
  preRun: async () => {
    /* 读取已在 extraSystem 中完成 */
  },
  postRun: async (ctx, result) => {
    if (!ctx.kbId) return;
    // 抽取每条灵感的第一行作为"钩子角度"用于去重
    const angles = result.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => /^\d+[\.、]/.test(l))
      .map((l) => l.replace(/^\d+[\.、]\s*/, '').slice(0, 40));
    const hooks = angles.length ? angles : [result.text.slice(0, 40)];
    appendInspiration(ctx.kbId, {
      ts: Date.now(),
      agentId: 'inspirer',
      mode: ctx.extra?.mode ? String(ctx.extra.mode) : undefined,
      angles: hooks
    });
  }
};
