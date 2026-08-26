// AI 模型配置
// 单一配置：AIModelConfig - 当前激活的模型设置
// 模型选项：ModelOption[] - 供 UI 下拉切换

/** 底层协议类型：Ollama 或 OpenAI 兼容 */
export type AIProvider = 'ollama' | 'openai' | 'none';

/** 用户可见的模型服务商（用于设置页与模型列表） */
export type AIServiceProvider = 'deepseek' | 'openai' | 'moonshot' | 'ollama' | 'none';

export interface ModelOption {
  /** 内部 id，例如 'deepseek-chat' */
  id: string;
  /** 显示名 */
  label: string;
  /** 简单描述 */
  desc?: string;
  /** 是否为推理模型 */
  reasoning?: boolean;
}

export interface AIModelConfig {
  /** 底层协议：ollama / openai / none */
  provider: AIProvider;
  /** 用户选择的模型服务商（持久化，用于 UI 模型列表） */
  serviceProvider?: AIServiceProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

/** 灵感方向（灵感工坊固定提示词条目） */
export interface InspirationModePrompt {
  key: string;
  icon: string;
  title: string;
  desc: string;
  prompt: string;
}

/** 固定的 AI 角色 / 发送提示词，可在「高级设置」中编辑并持久化 */
export interface AIPrompts {
  /** 灵感工坊：每天灵感一现 固定发送文本 */
  dailyInsight: string;
  /** 灵感工坊：灵感方向列表 */
  inspirationModes: InspirationModePrompt[];
  /** 全局对话：快捷提问（点击直接发送） */
  chatQuickPrompts: string[];
}

/** 灵感方向默认提示词（与改造前硬编码保持一致） */
export const DEFAULT_INSPIRATION_MODES: InspirationModePrompt[] = [
  {
    key: 'blindspot',
    icon: 'light-bulb',
    title: '思维盲区',
    desc: '找出我可能忽略的角度、前提与反例',
    prompt:
      '请基于我的知识库，指出我在当前议题上的「思维盲区」：我可能忽略的视角、隐含前提、常见认知偏差、以及关键反例。用「大多数人都容易忽略…」的口吻，给出 4~6 条具体、可对照的点。'
  },
  {
    key: 'complement',
    icon: 'sparkles',
    title: '补充思路',
    desc: '完善我现有的想法，补齐结构性缺口',
    prompt:
      '请基于我的知识库，对我的当前想法做「补充与完善」：补齐逻辑链缺口、补充关键证据/方法、指出可合并的相关笔记。给出 4~6 条可直接并入现有思路的补充项。'
  },
  {
    key: 'cases',
    icon: 'book-open',
    title: '延伸案例',
    desc: '提供类比、案例与跨领域参照，帮我了解更多',
    prompt:
      '请基于我的知识库，提供「延伸案例与跨领域参照」：类比、真实/行业案例、可迁移的方法论，帮助我把当前议题理解得更广。每条标注「类比点」与「可借鉴之处」，给 4~6 条。'
  },
  {
    key: 'reframe',
    icon: 'arrows-pointing-out',
    title: '换个角度',
    desc: '用不同范式/角色重新框架化问题',
    prompt:
      '请基于我的知识库，用「换框架」的方式重构我的议题：分别用第一性原理、用户视角、长期主义、逆向思维等 3~4 个框架重新提问并给出新结论，帮我突破原有思路。'
  }
];

/** 固定的 AI 提示词默认值 */
export const DEFAULT_AI_PROMPTS: AIPrompts = {
  dailyInsight:
    '请你给我一个醍醐灌顶的认知且当前知识库中未有的，它是有违人们常识的。人们平时做的都是反的，但真正正确的方法应该是这样的。正确的做法应该是什么样的？这个道理特别的简单，请你用大白话给我讲清楚，并且给我至少3个真实案例，每个案例要求有出处，不是运气。因为这个原理能够很好的佐证，刚才我们讲的那个常识，然后给一个最小可执行方法，一周以内的。不要鸡汤，我要实操。',
  inspirationModes: DEFAULT_INSPIRATION_MODES,
  chatQuickPrompts: [
    '帮我总结一下今天的笔记',
    '总结一下本周的笔记要点',
    '我最近在关注哪些主题？帮我梳理一下',
    '帮我把今天的笔记整理成待办清单'
  ]
};

/** 不同 provider 的模型选项（供 UI 切换） */
/** 各服务商默认 Base URL */
export const AI_SERVICE_DEFAULTS: Record<Exclude<AIServiceProvider, 'none'>, { label: string; protocol: AIProvider; baseUrl: string; defaultModel: string }> = {
  deepseek: {
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat'
  },
  openai: {
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini'
  },
  moonshot: {
    label: 'Moonshot',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-128k'
  },
  ollama: {
    label: 'Ollama',
    protocol: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    defaultModel: ''
  }
};

/** 各服务商可选模型列表（设置页 / 模型下拉共用） */
export const AI_SERVICE_MODELS: Record<Exclude<AIServiceProvider, 'none'>, ModelOption[]> = {
  deepseek: [
    { id: 'deepseek-chat', label: 'deepseek-chat', desc: 'DeepSeek V3 对话模型' },
    { id: 'deepseek-reasoner', label: 'deepseek-reasoner', desc: 'DeepSeek R1 推理模型', reasoning: true }
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini', desc: 'OpenAI GPT-4o mini' },
    { id: 'gpt-4o', label: 'gpt-4o', desc: 'OpenAI GPT-4o' }
  ],
  moonshot: [
    { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k', desc: 'Moonshot 8K' },
    { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k', desc: 'Moonshot 32K' },
    { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k', desc: 'Moonshot 128K' }
  ],
  ollama: [
    { id: 'qwen2.5:7b', label: 'qwen2.5:7b', desc: '通义千问 7B（中文友好）' },
    { id: 'qwen2.5:14b', label: 'qwen2.5:14b', desc: '通义千问 14B' },
    { id: 'llama3.1:8b', label: 'llama3.1:8b', desc: 'Llama 3.1 8B' },
    { id: 'deepseek-r1:7b', label: 'deepseek-r1:7b', desc: 'DeepSeek 推理 7B', reasoning: true }
  ]
};

/** 旧协议标签（保留用于降级显示） */
export const AI_PROVIDER_LABEL: Record<AIProvider, string> = {
  none: '未配置',
  ollama: 'Ollama',
  openai: 'OpenAI 兼容'
};

/** 从旧配置（仅有 provider/baseUrl）推断服务商，用于兼容升级 */
export function inferServiceProvider(cfg: AIModelConfig): AIServiceProvider {
  if (cfg.serviceProvider && cfg.serviceProvider !== 'none') return cfg.serviceProvider;
  if (cfg.provider === 'ollama') return 'ollama';
  const url = (cfg.baseUrl || '').toLowerCase();
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('moonshot') || url.includes('moonshot.cn')) return 'moonshot';
  if (url.includes('openai')) return 'openai';
  // 旧 openai 兼容默认都是 DeepSeek
  if (cfg.provider === 'openai') return 'deepseek';
  return 'none';
}

/** 保证配置同时包含 provider（协议）和 serviceProvider（服务商），缺失则补齐默认值 */
export function normalizeAIModelConfig(cfg: Partial<AIModelConfig>): AIModelConfig {
  const serviceProvider = inferServiceProvider(cfg as AIModelConfig) || 'deepseek';
  const def = AI_SERVICE_DEFAULTS[serviceProvider];
  const provider = def ? def.protocol : (cfg.provider || 'openai');
  return {
    provider,
    serviceProvider,
    baseUrl: cfg.baseUrl || def?.baseUrl || '',
    model: cfg.model || def?.defaultModel || '',
    apiKey: cfg.apiKey || ''
  };
}

/** AI 推荐笔记归档目录 */
export interface DirSuggestion {
  dirId: string;
  dirName: string;
  dirPath: string;
  reason: string;
  confidence: number;
}

/** AI 锻造的知识卡片草稿 */
export interface CardDraft {
  title: string;
  status: string;
  source: string;
  createdAt: string;
  coreIdea: string;
  details: string;
  actionable: string[];
  verification: string;
  relatedLinks: string[];
  suggestedTarget: { dirId: string; dirName: string; reason: string };
}

/** 知识库级 AI 提示词预设 */
export interface AIConfigPreset {
  name: string;
  content: string;
  active: boolean;
}

/** 快速笔记：大模型一次性产出的结构化结果 */
export interface QuickNoteResult {
  title: string; // 笔记标题
  summary: string; // 摘要（200 字内）
  dirId: string; // 推荐归属目录 id
  dirName: string; // 推荐归属目录真实名（NN 名称）
  tags: string[]; // 自动标签
  links: string[]; // 推荐双向链接（笔记名，不含 .md）
  sourceUrls: string[]; // 原始外部链接（内容含链接时提取，用于记录出处并归入外部资源）
  sourceTexts: { url: string; text: string }[]; // 抓取到的外部链接完整正文（用于落盘，保留整篇）
}