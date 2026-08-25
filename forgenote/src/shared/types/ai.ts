// AI 模型配置
// 单一配置：AIModelConfig - 当前激活的模型设置
// 模型选项：ModelOption[] - 供 UI 下拉切换

export type AIProvider = 'ollama' | 'openai' | 'none';

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
  provider: AIProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

/** 不同 provider 的模型选项（供 UI 切换） */
export const AI_MODELS: Record<Exclude<AIProvider, 'none'>, ModelOption[]> = {
  ollama: [
    { id: 'qwen2.5:7b', label: 'qwen2.5:7b', desc: '通义千问 7B（中文友好）' },
    { id: 'qwen2.5:14b', label: 'qwen2.5:14b', desc: '通义千问 14B' },
    { id: 'llama3.1:8b', label: 'llama3.1:8b', desc: 'Llama 3.1 8B' },
    { id: 'deepseek-r1:7b', label: 'deepseek-r1:7b', desc: 'DeepSeek 推理 7B', reasoning: true }
  ],
  openai: [
    { id: 'deepseek-chat', label: 'deepseek-chat', desc: 'DeepSeek V3 对话模型' },
    { id: 'deepseek-reasoner', label: 'deepseek-reasoner', desc: 'DeepSeek R1 推理模型', reasoning: true },
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini', desc: 'OpenAI GPT-4o mini' },
    { id: 'gpt-4o', label: 'gpt-4o', desc: 'OpenAI GPT-4o' },
    { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k', desc: '月之暗面 Moonshot 128K' }
  ]
};

export const AI_PROVIDER_LABEL: Record<AIProvider, string> = {
  none: '未配置',
  ollama: 'Ollama',
  openai: 'OpenAI 兼容'
};

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