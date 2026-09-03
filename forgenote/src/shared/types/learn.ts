// 主题学习（Learn）功能相关类型与内置学习模式
// 学习模式内置提示词与文体/严谨性约定，前端用于展示、后端用于组装系统提示。

export type LearnModeKey = 'normal' | 'study' | 'expert' | 'jianghushuo';

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
  /**
   * 固定方法论模式：置为 true 时，目录不交给模型自由规划，
   * 而是直接用内置的 fixedSteps 生成（保证方法论步骤不被模型改写/遗漏）。
   */
  fixedMethodology?: boolean;
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
  },
  {
    key: 'jianghushuo',
    title: '姜胡说快速学习',
    desc: '四步跨领域速成：抓核心 → 砍枝节 → 类比实战 → 取心法',
    icon: 'bolt',
    system:
      '你是「姜胡说」式的跨领域快速学习教练，信奉二八原则与最小可行行动：先帮新手锁定能覆盖 80% 场景的核心知识，再果断砍掉可延迟的枝节，用生活化类比让人秒懂，最后给出高手的第一性原理心法。',
    style:
      '直接、务实、不说教；优先给可执行的清单与判断标准；善用生活化类比与表格对比；每个结论都要能回答「所以我现在该怎么做」；避免堆砌术语与空泛的正确废话。',
    sampling: { temperature: 0.45, max_tokens: 1600 },
    fixedMethodology: true
  }
];

/**
 * 「姜胡说快速跨领域学习」的固定四步方法论。
 *
 * 与常规模式不同：目录不交给模型自由规划，而是固定为这 4 个模块 / 4 篇文章，
 * 保证方法论步骤不被模型改写或遗漏；每篇文章则用该步骤内置的提示词模板去问模型。
 *
 * prompt 模板里的 [某某领域] 会在运行时替换为用户输入的主题。
 * 第 3 步依赖第 1 步的产出（"第一条提示词告诉我的 3~5 条关键知识"），
 * 由 learn-service 在生成时把前序步骤正文注入上下文。
 */
export interface LearnFixedStep {
  /** 模块（栏目）标题，展示在左侧大纲 */
  moduleTitle: string;
  /** 该步骤下那篇文章的标题 */
  articleTitle: string;
  /** 一句话说明这一步在做什么（用于 outline / 进度提示） */
  summary: string;
  /** 该步骤的提示词模板，[某某领域] 会被替换为主题 */
  prompt: string;
  /**
   * 生成该步时，需要把前面哪些步骤（按顺序，1-based）的正文作为上下文注入。
   * 第 3 步填 [1]，即把第 1 步产出的「3~5 条关键知识」带进去。
   */
  dependsOn?: number[];
}

export const JIANGHUSHUO_STEPS: LearnFixedStep[] = [
  {
    moduleTitle: '第一步 · 锁定 20% 核心知识',
    articleTitle: '锁定覆盖 80% 场景的核心知识',
    summary: '用二八原则找出最少且必备的知识',
    prompt: `我是一个完全的新手，但我想快速进入[某某领域]。请你根据二八原则，告诉我这个领域最少且必备的知识，帮我列出3~5条最关键的知识。
要求：
1、能涵盖这个领域80%的使用场景
2、告诉我这些概念为什么重要
3、那些很重要、但在实操过程中一定会接触到的知识，不必列入`
  },
  {
    moduleTitle: '第二步 · 排除可延迟的 80%',
    articleTitle: '排除看似重要、实则可延迟的知识',
    summary: '砍掉新手常犯的低效误区与可延后概念',
    prompt: `在学习[某某领域]的过程中，作为新手经常陷入哪些低效的、或者完全没必要现在就学习的误区？帮我列出三条看起来很基础、但实际上完全可以延迟学习的概念。
告诉我：
1、为什么它可以被延迟
2、暂时不学习它会造成什么影响`
  },
  {
    moduleTitle: '第三步 · 类比理解 + 一周实战',
    articleTitle: '用生活化类比理解，并交付一周可完成的最小任务',
    summary: '把核心概念类比成生活场景，配一周可完成的最小任务',
    prompt: `请你使用类比思维，尤其最好是生活化的场景，来给我解释第一条提示词告诉我的3~5条关键知识和概念。并且请你帮我设置一个最小可行的任务，让我能够在一周之内就完成这个任务，通过这个任务掌握这些相关知识，建立信心。`,
    dependsOn: [1]
  },
  {
    moduleTitle: '第四步 · 直击第一性原理',
    articleTitle: '顶尖高手与普通人的核心差别与心法',
    summary: '抛开噪音，拿到最接近核心的一条心法',
    prompt: `[某某领域]的顶尖高手和普通人最大的区别是什么？请你给我一个最接近核心的心法或原则。`
  }
];

/** 内置「固定方法论」模式 → 步骤清单；没有固定步骤的模式返回 null */
export function getFixedSteps(key: LearnModeKey): LearnFixedStep[] | null {
  if (key === 'jianghushuo') return JIANGHUSHUO_STEPS;
  return null;
}

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
