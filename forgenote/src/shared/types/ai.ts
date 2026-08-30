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
  /** 外部 MCP Server 配置（方案 §6.4）。默认空数组 = 不启用外部 MCP。 */
  mcpServers?: MCPServerConfig[];
}

/** 外部 MCP Server 配置（stdio / SSE）。见 doc/AI调用重构技术方案.md §6.4 */
export interface MCPServerConfig {
  name: string;
  /** 'stdio'：通过命令行启动本地进程；'sse'：连接远程 MCP 端点 */
  transport: 'stdio' | 'sse';
  /** stdio 模式：启动命令，如 'npx' */
  command?: string;
  /** stdio 模式：启动参数 */
  args?: string[];
  /** sse 模式：远程端点 URL */
  url?: string;
  /** 环境变量（可选，KEY=VALUE），用于 stdio 子进程启动 */
  env?: Record<string, string>;
  /** 是否启用（外部 MCP 默认需显式开启） */
  enabled?: boolean;
  /** 服务说明（可选，用于设置页展示） */
  description?: string;
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

/** 预置的外部 MCP 服务（默认禁用，用户在设置中显式启用）。预置逻辑见 mergeDefaultMCPServers 及 doc/MCP技术实现方案.md */
export const DEFAULT_MCP_SERVERS: MCPServerConfig[] = [
  {
    name: 'open-websearch',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'open-websearch@latest'],
    env: {
      MODE: 'stdio',
      // 默认搜索引擎；多引擎可自由切换，无需 API Key
      DEFAULT_SEARCH_ENGINE: 'baidu',
      // 允许的搜索引擎（逗号分隔）：国内可用 baidu/csdn，海外可用 bing/duckduckgo/brave/exa 等
      ALLOWED_SEARCH_ENGINES: 'bing,baidu,duckduckgo,brave,exa,csdn',
      // 走与 DuckDuckGo 相同的系统代理策略，便于国内网络环境访问
      USE_PROXY: 'false'
    },
    enabled: true,
    description: 'Open Web Search 多引擎搜索：内置 Bing、百度、DuckDuckGo、Brave、Exa、CSDN 等，支持国内搜索引擎，零 API Key（纯 Node 版 npx 运行）'
  }
];

/** 保证配置同时包含 provider（协议）和 serviceProvider（服务商），缺失则补齐默认值 */
export function normalizeAIModelConfig(cfg: Partial<AIModelConfig>): AIModelConfig {
  const serviceProvider = (inferServiceProvider(cfg as AIModelConfig) || 'deepseek') as Exclude<AIServiceProvider, 'none'>;
  const def = AI_SERVICE_DEFAULTS[serviceProvider];
  const provider = def ? def.protocol : (cfg.provider || 'openai');
  return {
    provider,
    serviceProvider,
    baseUrl: cfg.baseUrl || def?.baseUrl || '',
    model: cfg.model || def?.defaultModel || '',
    apiKey: cfg.apiKey || '',
    mcpServers: mergeDefaultMCPServers(cfg.mcpServers)
  };
}

/**
 * 合并预置 MCP 服务与用户已存配置：
 * - 预置项若用户已手动存在（按 name 匹配），保留用户配置（含启用状态/删除）；
 * - 用户自定义的项原样保留；
 * - 新升级的用户自动获得预置项（默认禁用）。
 */
function mergeDefaultMCPServers(existing?: MCPServerConfig[]): MCPServerConfig[] {
  const saved = existing ?? [];
  const savedNames = new Set(saved.map((s) => s.name));
  const presets = DEFAULT_MCP_SERVERS.filter((p) => !savedNames.has(p.name));
  return [...saved, ...presets];
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

// ===================== AI 调用重构：统一层 / 会话 / Skill =====================
// 见 doc/AI调用重构技术方案.md

/** 引用溯源：AI 回答命中到的知识库笔记 */
export interface AIRefHit {
  path: string; // 笔记相对路径（含 .md）
  name: string; // 笔记名（不含 .md）
  snippet?: string; // 命中片段
}

/** Token 用量（成本可观测，方案 §三.3） */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ms: number;
}

/** 单次会话轮次 */
export interface AITurn {
  role: 'user' | 'assistant' | 'tool';
  text?: string; // user / assistant 文本
  toolCalls?: unknown[]; // assistant 发起的工具调用（MCP 占位）
  toolResults?: unknown[]; // 工具返回
  skill?: string;
  ts: number;
}

/** 多轮会话（承载上下文，支持「建议→确认→执行」） */
export interface AISession {
  id: string;
  kbId?: string;
  skill: string;
  turns: AITurn[]; // 完整多轮历史
  draft?: unknown; // 待确认的「建议草稿」
  createdAt: number;
  updatedAt: number;
}

/** AI 请求（统一入口 AIHub.run 的参数） */
export interface AIRequest {
  skill: string; // 'ask' | 'quick-note' | 'forge-card' | ...
  input: Record<string, unknown>; // 结构化入参（由 Skill 约束）
  kbId?: string;
  /** 多 Agent 方案：指定 Agent 角色；缺省时按 SKILL_TO_AGENT 映射（doc/多Agent技术实现方案.md §3.5） */
  agentId?: string;
  /** 透传给 Agent 的额外参数（如 inspirer 的 mode） */
  extra?: Record<string, unknown>;
  stream?: boolean;
  signal?: AbortSignal;
  modelOverride?: string;
  sessionId?: string; // 携带则续接历史；缺省新建一次性会话
  history?: AITurn[]; // 或由 AIHub 从 SessionStore 自动载入
  confirm?: boolean; // 确认上一轮 draft（多轮确认执行）
  draft?: unknown; // 待确认的草稿（confirm=true 时）
  onActivity?: (a: ToolActivity) => void; // 工具调用活动回调（agent / 时间路由，#4）
}

/** AI 统一响应 */
export type AIResponse =
  | { kind: 'text'; text: string }
  | { kind: 'structured'; data: unknown; pending?: boolean } // pending=true 表示待确认草稿
  | { kind: 'stream'; text: string }
  | { kind: 'tool'; steps: unknown[] };

/** 工具调用活动（agent / 时间路由过程中 AI 调用工具的可观测记录，#4） */
export interface ToolActivity {
  name: string; // 工具名（如 kb_search / kb_read_note）
  args: Record<string, unknown>;
  result: string;
}

// ===================== MCP 确认执行（doc/MCP技术实现方案.md） =====================
// AI 先产出「建议」（ConfirmableAction，pending），用户确认后才真正执行。

/** 笔记 Patch 的单个操作 */
export interface NotePatchOp {
  op: 'set_frontmatter' | 'replace' | 'insert_after' | 'append' | 'delete_lines';
  /** frontmatter 键名（op=set_frontmatter 时必填） */
  key?: string;
  /** frontmatter 值（op=set_frontmatter 时用） */
  value?: unknown;
  /** 被替换的原始文本（op=replace 时必填） */
  oldText?: string;
  /** 替换后的文本（op=replace 时用） */
  newText?: string;
  /** 定位锚点文本（op=insert_after 时必填） */
  anchor?: string;
  /** 插入/追加的文本（op=insert_after / op=append 时用） */
  text?: string;
  /** 起始行号，1-based（op=delete_lines 时用） */
  startLine?: number;
  /** 结束行号，含（op=delete_lines 时用） */
  endLine?: number;
}

/** 笔记 Patch 预览结果（主进程生成，模型只引用 previewId，不复制 diff 正文） */
export interface NotePatchPreview {
  previewId: string;
  notePath: string;
  /** 该 Patch 是否可安全应用（如 replace 的 oldText 是否命中） */
  canApply: boolean;
  /** unified diff 文本 */
  diff: string;
  /** 影响的行/处数 */
  affectedLines: number;
  /** 失败原因（canApply=false 时） */
  message?: string;
}

/** notePatch 类型 action 的 payload */
export interface NotePatchPayload {
  notePath: string;
  /** 主进程兜底生成建议时可直接用 previewId 关联已存 ops */
  ops?: NotePatchOp[];
  /** 若由 kb_preview_patch 生成过预览，带上 previewId 可校验「所见即所改」 */
  previewId?: string;
}

/** 需要用户确认后才执行的 AI 建议操作 */
export interface ConfirmableAction<P = unknown, V = unknown> {
  id: string;
  /** 'notePatch' | 'settingUpdate' | 'openDialog' | 'moveNote' | 'createNote' | 'external.<server>.<tool>' */
  type: string;
  /** 卡片标题，如「修改：01 项目/foo.md」 */
  title: string;
  /** AI 对本次操作的说明 */
  description: string;
  /** 执行所需参数 */
  payload: P;
  /** 渲染预览用的数据（主进程填装，模型不产出） */
  preview?: V;
}

/** 便捷别名：笔记修改类 action */
export type NotePatchAction = ConfirmableAction<NotePatchPayload, NotePatchPreview>;

// ===================== 批量任务（doc/AI智能管家重构方案.md §6.2 P2-4） =====================
// 一次整理几十篇笔记时，需要进度、部分失败重试与整体回滚，
// 逐篇确认会让用户点到崩溃，因此单独抽象「批量」确认类型。

/** 批量执行结果 */
export interface BatchResult {
  batchId: string;
  total: number;
  succeeded: number;
  failed: { item: unknown; reason: string }[];
  /** 所有成功项都有快照时才能整体回滚 */
  canRollback: boolean;
}

/** batchPatch 的 payload */
export interface BatchPatchPayload {
  items: NotePatchPayload[];
}

/** batchPatch 的预览 */
export interface BatchPatchPreview {
  items: NotePatchPreview[];
  /** 可安全应用的数量（其余会在执行时跳过） */
  applicable: number;
}

/** batchMove 的 payload */
export interface BatchMovePayload {
  items: { fromPath: string; toDirPath: string; autoCreateDir?: boolean }[];
}

/** batchRetag 的 payload */
export interface BatchRetagPayload {
  items: { notePath: string; tags: string[] }[];
}

// ===================== 知识库巡检（doc/AI智能管家重构方案.md §5.2 P2-1） =====================
// 规则类检查项完全不依赖模型：未配置 AI 时也能完成基础体检。

export type PatrolSeverity = 'high' | 'medium' | 'low';

export type PatrolCategory =
  | 'broken-link'
  | 'duplicate'
  | 'orphan'
  | 'empty-dir'
  | 'sparse-tag'
  | 'structure'
  | 'stale'
  /** 版本历史占用（doc/笔记版本实现方案.md §9.2） */
  | 'version-size';

export interface PatrolFinding {
  id: string;
  severity: PatrolSeverity;
  category: PatrolCategory;
  title: string;
  detail: string;
  /** 受影响的笔记 / 目录 / 标签 */
  affected: string[];
  /** 可一键执行的建议动作（走 confirmable-action 框架）；无则仅提示 */
  suggestion?: ConfirmableAction;
  /** 去重键：用于主动建议节流 */
  dedupeKey: string;
}

export interface PatrolStats {
  noteCount: number;
  dirCount: number;
  tagCount: number;
  linkCount: number;
  brokenLinkCount: number;
  orphanCount: number;
  untaggedCount: number;
}

export interface PatrolReport {
  kbId: string;
  at: number;
  stats: PatrolStats;
  findings: PatrolFinding[];
  /** 综合健康分 0-100 */
  score: number;
}

/** Skill 声明（能力单元） */
export interface Skill {
  id: string;
  title: string;
  description: string;
  capability?: ('reasoning' | 'long-context' | 'cheap')[];
  stateful?: boolean; // 是否需要跨轮上下文
  awaitConfirm?: boolean; // 首轮只出 draft，确认后才执行写操作
  run: (ctx: SkillRunCtx) => Promise<AIResponse> | AIResponse;
}

/** Skill 执行上下文 */
export interface SkillRunCtx {
  input: Record<string, unknown>;
  kbId?: string;
  session?: AISession; // 已载入的历史会话
  confirm?: boolean; // 是否确认上一轮 draft
  ai: AIServiceLike; // 底层 AI 调用能力
}

/** 底层 AI 调用协议接口（AIHub 注入，解耦具体实现） */
export interface AIServiceLike {
  askWithHistory: (
    kbId: string | undefined,
    history: { role: 'user' | 'assistant'; text: string }[],
    question: string,
    opts?: { templateDirIds?: string[] }
  ) => Promise<string>;
  getConfig: () => AIModelConfig;
  isReady: () => boolean;
}

/** 多 Agent 方案（doc/多Agent技术实现方案.md §4.6.2）：用户覆写结构，落库 app_config['ai:agents'] */
export interface AgentOverridesLike {
  [agentId: string]: {
    systemPrompt?: string;
    sampling?: Partial<{ temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number }>;
    retrieval?: Partial<{ enabled?: boolean; topK?: number; includeDirTree?: boolean; includeOrphans?: boolean }>;
    profileFields?: Array<'basics' | 'interests' | 'preferences' | 'recentFocus' | 'longTerm'>;
    extraSystem?: string;
  };
}