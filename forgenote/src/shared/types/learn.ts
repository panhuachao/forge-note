// 主题学习（Learn）功能相关类型与内置学习模式
// 学习模式内置提示词与文体/严谨性约定，前端用于展示、后端用于组装系统提示。

export type LearnModeKey = 'normal' | 'study' | 'expert';

export interface LearnMode {
  key: LearnModeKey;
  title: string;
  desc: string;
  /** 仅用于前端展示的图标名（对应 Icon.tsx 的 IconName） */
  icon: string;
  /** 追加到系统提示的「角色/能力」约定 */
  system: string;
  /** 追加到系统提示的「输出文体/严谨性」约定 */
  style: string;
  /** 采样参数：不同模式对应不同 temperature 与篇幅 */
  sampling: { temperature: number; max_tokens?: number };
}

export const LEARN_MODES: LearnMode[] = [
  {
    key: 'normal',
    title: '普通模式',
    desc: '通俗易读，适合快速建立概览',
    icon: 'book-open',
    system:
      '用通俗、平实的语言讲解，面向零基础读者，多用生活化类比，避免晦涩术语；遇到专业概念先解释再使用，必要时给出一句话记忆点。',
    style:
      '段落短小、配小标题与要点列表；按「是什么 → 为什么 → 怎么用」组织；语气可稍轻松，但必须保证事实准确，不编造。',
    sampling: { temperature: 0.5, max_tokens: 1400 }
  },
  {
    key: 'study',
    title: '学习模式',
    desc: '系统成体系，适合按路径深入学习',
    icon: 'academic-cap',
    system:
      '以教学者视角组织知识，强调概念之间的逻辑脉络与演进关系；先建立整体框架再填充细节；适当布置「思考 / 自测」环节帮助巩固。',
    style:
      '结构清晰：概念定义 → 原理 → 示例 → 常见误区 → 小结；善用表格 / 对比 / 图示化列表；语言准确但不卖弄，兼顾深度与可读性。',
    sampling: { temperature: 0.35, max_tokens: 1600 }
  },
  {
    key: 'expert',
    title: '专家模式',
    desc: '严谨深入，适合专业研究与落地',
    icon: 'shield-check',
    system:
      '以领域专家视角撰写，强调严谨性、边界条件、权衡取舍与学术 / 工业前沿；给出方法论与可验证来源思路；明确指出不确定性与争议点。',
    style:
      '正式、精确、可落地；含形式化定义、复杂度 / 成本分析、反例与陷阱、参考文献思路；避免泛泛而谈与营销式措辞。',
    sampling: { temperature: 0.2, max_tokens: 1900 }
  }
];

export function getLearnMode(key: string): LearnMode {
  return LEARN_MODES.find((m) => m.key === key) ?? LEARN_MODES[0];
}

export interface LearnArticle {
  id: string;
  title: string;
  /** 计划阶段生成的大纲要点 */
  outline?: string[];
  /** 生成后的 Markdown 正文 */
  content: string;
  /** 存储层内部字段：正文对应的相对 .md 文件名（位于主题文件夹内），仅落库/读取时使用 */
  file?: string;
}

export interface LearnModule {
  id: string;
  title: string;
  articles: LearnArticle[];
}

export type LearnStatus = 'planning' | 'generating' | 'done' | 'error';

export interface LearningSession {
  id: string;
  topic: string;
  extra: string;
  mode: LearnModeKey;
  modeTitle: string;
  createdAt: number;
  modules: LearnModule[];
  status: LearnStatus;
  error?: string;
}

export interface LearnSessionSummary {
  id: string;
  topic: string;
  mode: LearnModeKey;
  modeTitle: string;
  createdAt: number;
  moduleCount: number;
  articleCount: number;
  status: LearnStatus;
}

/** 生成过程中的进度事件（主进程 → 渲染层） */
export interface LearnProgress {
  phase: 'planning' | 'plan-ready' | 'article-start' | 'article-done' | 'done' | 'error';
  sessionId: string;
  message: string;
  /** 当前阶段：1 = 第一步生成目录架构；2 = 第二步逐篇生成文章 */
  step?: 1 | 2;
  /** 当前文章序号（全局，1-based，仅 step=2 时有意义） */
  articleNo?: number;
  /** 文章总数（仅 step=2 时有意义） */
  totalArticles?: number;
  modules?: LearnModule[];
  moduleIndex?: number;
  articleIndex?: number;
  title?: string;
  content?: string;
}

export interface LearnCreateInput {
  topic: string;
  extra: string;
  mode: LearnModeKey;
}
