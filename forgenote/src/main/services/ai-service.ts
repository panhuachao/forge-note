// AI 服务 - LLM 客户端、提示词组装、归纳/链接/卡片引擎
import { promises as fs } from 'fs';
import { join } from 'path';
import { getKB, getConfig, setConfig, saveAIPreset, getAIPresets } from './store';
import { safeJoin, atomicWrite } from '../utils/fs';
import { eventBus } from '../utils/event-bus';
import { fsService } from './fs-service';
import type { AIModelConfig, DirSuggestion, LinkInfo, CardDraft, QuickNoteResult, AIPrompts, ProfileExtractResult } from '@shared/types';
import { DEFAULT_AI_PROMPTS, normalizeAIModelConfig } from '@shared/types/ai';
import type { AIRefHit } from '@shared/types/ai';
import type { SearchResult } from '@shared/types';
import { extractWikiLinks, previewLine, writeFrontmatter } from '../utils/markdown';
import { linkIndex } from './link-index';
import { searchService } from './search-service';
import { retrieve, rerankHits } from './rag-service';
import { allTools, WRITE_TOOLS, executeTool, ToolCall, ToolActivity, type MCPTool } from './tool-runtime';
import { listExternalTools, executeExternalTool, isExternalTool } from './mcp-client';
import { profileService } from './profile-service';
import { agentRegistry } from './agents/registry';
import { composeAgentSystem } from './agents/compose';
import { mergeSampling } from './agents/sampling';
import type { AgentRunCtx, AgentProfile } from './agents/types';

/**
 * 按 name 合并两组 MCP 服务配置：base（磁盘已有）优先保留用户已设置的字段，
 * override（传入的新值）中同名服务覆盖对应字段；override 的新增服务直接追加。
 * 用户已启用的服务不会被预置默认值（enabled:false）覆盖。
 */
function mergeMCPServers(
  base: import('@shared/types').MCPServerConfig[],
  override: import('@shared/types').MCPServerConfig[]
): import('@shared/types').MCPServerConfig[] {
  const byName = new Map<string, import('@shared/types').MCPServerConfig>();
  for (const s of base) byName.set(s.name, { ...s });
  for (const s of override) {
    const prev = byName.get(s.name);
    byName.set(s.name, prev ? { ...prev, ...s } : { ...s });
  }
  return Array.from(byName.values());
}

const BASE_SYSTEM = `你是「锦囊笔记 ForgeNote」内置的本地 AI 知识管家，遵循以下铁律：
1. 优先基于用户提供的笔记内容与知识库上下文回答，不编造本地资料中不存在的信息。
2. 不得自动修改、删除、移动任何文件；所有结构性变更（移动笔记、插入链接、锻造卡片）必须由用户显式确认。
3. 引用笔记时请使用 [[笔记名]] 语法。
4. 当用户请求市场分析、案例延伸、竞品对比等本地资料不足以直接回答的任务时，可结合通用知识进行合理推演与补充，但必须明确区分：哪些结论来自本地资料，哪些是基于通用知识的推断，并提醒用户核实关键数据。`;

class AIService {
  /** 在 BASE_SYSTEM 后追加用户画像长期上下文（阶段 A 注入，doc/用户画像实现方案.md §5.1） */
  private async systemWithProfile(kbId: string | undefined, extra = ''): Promise<string> {
    let block = '';
    if (kbId) {
      try {
        const p = await profileService.getProfile(kbId);
        block = profileService.renderProfileBlock(p);
      } catch {
        /* 画像读取失败不影响主对话 */
      }
    }
    // 注入当前真实日期（防止 AI 把"今天"误读成历史会话的旧日期）
    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeHint = `\n\n【当前真实日期】${today}。用户所问的"今天/本周/本月"即对应此日期，请据此判定时间窗口，不要凭历史会话或旧记忆猜测。`;
    return `${BASE_SYSTEM}${timeHint}${block ? '\n\n' + block : ''}${extra ? '\n\n' + extra : ''}`;
  }

  private configCache: AIModelConfig | null = null;

  async getConfig(): Promise<AIModelConfig> {
    if (this.configCache) return normalizeAIModelConfig(this.configCache);
    const raw = getConfig<AIModelConfig>('ai:config', { provider: 'none' });
    this.configCache = normalizeAIModelConfig(raw || { provider: 'none' });
    return this.configCache;
  }

  /** 同步读取 AI 配置（优先缓存）。外部 MCP 适配层（mcp-client.ts）需在不 await 的上下文取配置时用。 */
  getConfigSync(): AIModelConfig {
    if (this.configCache) return normalizeAIModelConfig(this.configCache);
    const raw = getConfig<AIModelConfig>('ai:config', { provider: 'none' });
    this.configCache = normalizeAIModelConfig(raw || { provider: 'none' });
    return this.configCache;
  }

  async setConfig(cfg: Partial<AIModelConfig>): Promise<void> {
    const cur = await this.getConfig();
    // 按 name 深合并 mcpServers：用户已保存的服务（含 enabled）始终优先于预置默认，
    // 避免任何浅合并路径把用户启用的外部 MCP 覆盖回默认禁用。
    const mergedServers =
      Array.isArray(cfg.mcpServers) && cur.mcpServers
        ? mergeMCPServers(cur.mcpServers, cfg.mcpServers)
        : (cfg.mcpServers ?? cur.mcpServers);
    const next = { ...cur, ...cfg, mcpServers: mergedServers };
    setConfig('ai:config', next);
    this.configCache = next;
  }

  /** 读取固定的 AI 提示词（灵感方向 / 每天灵感一现 / 对话快捷提问），带默认值兜底 */
  async getPrompts(): Promise<AIPrompts> {
    const saved = getConfig<AIPrompts>('ai:prompts', DEFAULT_AI_PROMPTS);
    // 深合并默认值，保证新增字段在旧配置中也有值
    return {
      dailyInsight: saved?.dailyInsight ?? DEFAULT_AI_PROMPTS.dailyInsight,
      inspirationModes: saved?.inspirationModes?.length ? saved.inspirationModes : DEFAULT_AI_PROMPTS.inspirationModes,
      chatQuickPrompts: saved?.chatQuickPrompts?.length ? saved.chatQuickPrompts : DEFAULT_AI_PROMPTS.chatQuickPrompts
    };
  }

  /** 保存固定的 AI 提示词（持久化到 app_config） */
  async setPrompts(prompts: AIPrompts): Promise<void> {
    setConfig('ai:prompts', prompts);
  }

  private isEnabled(cfg: AIModelConfig): boolean {
    // 只要求 provider 与 apiKey 有效；model/baseUrl 缺失时由调用方给默认值
    return cfg.provider !== 'none' && !!cfg.apiKey;
  }

  /**
   * 通用聊天（流式）。本项目为简化实现，主进程一次性返回；渲染层用 chunked 渲染。
   */
  async chat(prompt: string, sysPrompt: string, sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number }): Promise<string> {
    const cfg = await this.getConfig();
    if (!this.isEnabled(cfg)) {
      // 降级：本地规则引擎
      return this.localFallback(prompt, sysPrompt);
    }
    if (cfg.provider === 'ollama') {
      const c: AIModelConfig = { ...cfg, baseUrl: cfg.baseUrl || 'http://127.0.0.1:11434', model: cfg.model || 'qwen2.5:7b' };
      return this.callOllama(c, sysPrompt, prompt, sampling);
    }
    if (cfg.provider === 'openai') {
      // 提供合理默认值，避免用户漏填 model/baseUrl 直接降级
      const c: AIModelConfig = {
        ...cfg,
        baseUrl: cfg.baseUrl || 'https://api.deepseek.com/v1',
        model: cfg.model || 'deepseek-chat'
      };
      return this.callOpenAI(c, sysPrompt, prompt, sampling);
    }
    return this.localFallback(prompt, sysPrompt);
  }

  /** 用量统计（成本可观测，方案 §三.3） */
  async recordUsage(skill: string, usage: { promptTokens: number; completionTokens: number; ms: number }): Promise<void> {
    const cur = getConfig<Record<string, { calls: number; tokens: number; ms: number }>>('ai:usage', {}) ?? {};
    const e = cur[skill] ?? { calls: 0, tokens: 0, ms: 0 };
    e.calls += 1;
    e.tokens += usage.promptTokens + usage.completionTokens;
    e.ms += usage.ms;
    cur[skill] = e;
    setConfig('ai:usage', cur);
  }

  getUsage(): Record<string, { calls: number; tokens: number; ms: number }> {
    return getConfig<Record<string, { calls: number; tokens: number; ms: number }>>('ai:usage', {}) ?? {};
  }

  resetUsage(): void {
    setConfig('ai:usage', {});
  }

  /**
   * 流式对话（SSE/逐 token 渲染，方案 §三.1）。
   * 返回 AsyncGenerator：每收到一段即 yield { delta }；结束时可能附带 usage（仅 openai/ollama 能在响应里得到）。
   * 本地降级（无模型）会一次性 yield 完整文本。
   */
  async *streamChat(
    prompt: string,
    sysPrompt: string,
    opts?: { signal?: AbortSignal; sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number } }
  ): AsyncGenerator<{ delta: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const cfg = await this.getConfig();
    const start = Date.now();
    const t0 = start;
    if (!this.isEnabled(cfg)) {
      yield { delta: await this.localFallback(prompt, sysPrompt) };
      return;
    }
    try {
      if (cfg.provider === 'ollama') {
        const base = cfg.baseUrl || 'http://127.0.0.1:11434';
        const r = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model || 'qwen2.5:7b',
            stream: true,
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: prompt }
            ]
          }),
          signal: opts?.signal
        });
        if (!r.ok) throw new Error(`Ollama 调用失败: ${r.status}`);
        const reader = r.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            try {
              const j = JSON.parse(line);
              if (j.message?.content) yield { delta: j.message.content };
              if (j.done) {
                const u = j.prompt_eval_count ?? j.prompt_eval_count;
                if (typeof j.prompt_eval_count === 'number' && typeof j.eval_count === 'number') {
                  yield { delta: '', usage: { promptTokens: j.prompt_eval_count, completionTokens: j.eval_count, totalTokens: j.prompt_eval_count + j.eval_count } };
                }
              }
            } catch {
              /* 跳过非 JSON 行 */
            }
          }
        }
        return;
      }
      if (cfg.provider === 'openai') {
        const base = cfg.baseUrl || 'https://api.deepseek.com/v1';
        const r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey || ''}` },
          body: JSON.stringify({
            model: cfg.model || 'deepseek-chat',
            stream: true,
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: prompt }
            ],
            temperature: opts?.sampling?.temperature ?? 0.3,
            ...(opts?.sampling?.top_p !== undefined ? { top_p: opts.sampling.top_p } : {}),
            ...(opts?.sampling?.presence_penalty !== undefined ? { presence_penalty: opts.sampling.presence_penalty } : {}),
            ...(opts?.sampling?.frequency_penalty !== undefined ? { frequency_penalty: opts.sampling.frequency_penalty } : {}),
            ...(opts?.sampling?.max_tokens !== undefined ? { max_tokens: opts.sampling.max_tokens } : {})
          }),
          signal: opts?.signal
        });
        if (!r.ok) throw new Error(`OpenAI 调用失败: ${r.status} ${await r.text()}`);
        const reader = r.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line || !line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) yield { delta };
              const u = j.usage;
              if (u) usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens };
            } catch {
              /* 跳过非 JSON 行 */
            }
          }
        }
        if (usage) yield { delta: '', usage };
        return;
      }
    } catch (e) {
      yield { delta: `AI 调用失败: ${String(e)}` };
      return;
    }
    void t0;
  }

  private async callOllama(cfg: AIModelConfig, sys: string, user: string, sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number }): Promise<string> {
    const base = cfg.baseUrl || 'http://127.0.0.1:11434';
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        ...(sampling && sampling.temperature !== undefined ? { options: { temperature: sampling.temperature, presence_penalty: sampling.presence_penalty ?? 0, frequency_penalty: sampling.frequency_penalty ?? 0 } } : {})
      })
    });
    if (!r.ok) throw new Error(`Ollama 调用失败: ${r.status} ${await r.text()}`);
    const data = (await r.json()) as { message: { content: string } };
    return data.message.content || '';
  }

  private async callOpenAI(cfg: AIModelConfig, sys: string, user: string, sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number }): Promise<string> {
    const base = cfg.baseUrl || 'https://api.openai.com/v1';
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey || ''}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        temperature: sampling?.temperature ?? 0.3,
        ...(sampling?.top_p !== undefined ? { top_p: sampling.top_p } : {}),
        ...(sampling?.presence_penalty !== undefined ? { presence_penalty: sampling.presence_penalty } : {}),
        ...(sampling?.frequency_penalty !== undefined ? { frequency_penalty: sampling.frequency_penalty } : {}),
        ...(sampling?.max_tokens !== undefined ? { max_tokens: sampling.max_tokens } : {})
      })
    });
    if (!r.ok) throw new Error(`OpenAI 调用失败: ${r.status} ${await r.text()}`);
    const data = (await r.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content || '';
  }

  /**
   * 降级：基于关键词与目录规则的本地推荐
   */
  private async localFallback(prompt: string, sys: string): Promise<string> {
    // 极简：原样返回，让上层解析
    return prompt.includes('请输出 JSON') ? '[]' : '当前无 AI 模型可用，已切换到本地规则引擎。';
  }

  /**
   * 读取 AI_CONFIG.md（带 5s 缓存）
   */
  private aiConfigCache = new Map<string, { content: string; ts: number }>();
  async getAIConfigContent(kbId: string): Promise<string> {
    const c = this.aiConfigCache.get(kbId);
    if (c && Date.now() - c.ts < 5000) return c.content;
    const kb = getKB(kbId);
    if (!kb) return '';
    try {
      const content = await fs.readFile(join(kb.rootPath, '.AI_CONFIG.md'), 'utf-8');
      this.aiConfigCache.set(kbId, { content, ts: Date.now() });
      return content;
    } catch {
      return '';
    }
  }

  invalidateAIConfig(kbId: string) {
    this.aiConfigCache.delete(kbId);
  }

  /**
   * RAG 问答
   */
  async ask(kbId: string, question: string, opts?: { templateDirIds?: string[] }): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return '';
    // 诊断：确认主进程实际读到的 AI 配置
    const diag = await this.getConfig();
    console.log('[ai.ask] kbId=', kbId, 'service=', diag.serviceProvider, 'protocol=', diag.provider, 'model=', diag.model, 'baseUrl=', diag.baseUrl);

    // 1) 统一 RAG 召回（分块 + 重排 + 引用锚点）
    const { hits } = await retrieve(kbId, question, { templateDirIds: opts?.templateDirIds, topK: 12 });
    const hitContext = hits
      .map((h) => {
        const anchor = h.heading ? `[[${h.noteName}#${h.heading}]]` : `[[${h.noteName}]]`;
        return `### ${anchor}${h.startLine ? ` (行 ${h.startLine})` : ''}\n路径: ${h.notePath}\n片段: ${h.snippet}`;
      })
      .join('\n\n');

    // 2) 知识库目录结构（全局视角）—— 始终附带，让 AI 能基于目录做归纳
    const dirTree = await this.buildDirOverview(kb.rootPath, kbId);

    // 3) 若用户问的是"某个目录下整体内容"，整目录读取作为上下文
    const fullDirContext = await this.maybeReadFullDir(kb.rootPath, kbId, question, hits);

    const extra = `${dirTree}\n\n${fullDirContext ? `# 目录整体内容（与问题强相关）\n${fullDirContext}\n\n` : ''}# 关键词检索片段（top ${hits.length}）\n${hitContext || '（未检索到与问题关键词精确匹配的片段）'}\n\n回答要求：\n- 若问题涉及"归纳/总结/进展/整体情况"，请基于【目录结构 + 目录整体内容】做归纳，引用具体笔记用 [[笔记名]]\n- 若问题涉及"如何使用某目录/目录是否合理"，请基于目录说明（README）和已有笔记分布给出建议\n- 引用时优先用 [[笔记名]] 形式标注`;
    const sys = await this.systemWithProfile(kbId, extra);
    return this.chat(question, sys);
  }

  /**
   * 统一的「检索上下文构建」入口，供多 Agent 方案复用（doc/多Agent技术实现方案.md §4.3.2）。
   * 根据 AgentRetrieval 策略决定：是否召回、topK、是否附带目录树、是否读取整目录内容。
   */
  async buildRetrievalContext(
    kbId: string,
    question: string,
    retrieval?: { enabled?: boolean; topK?: number; includeDirTree?: boolean; includeOrphans?: boolean }
  ): Promise<string> {
    if (!retrieval?.enabled) return '';
    const kb = getKB(kbId);
    if (!kb) return '';
    const topK = retrieval.topK ?? 12;
    const { hits } = await retrieve(kbId, question, { topK });
    const hitContext = hits
      .map((h) => {
        const anchor = h.heading ? `[[${h.noteName}#${h.heading}]]` : `[[${h.noteName}]]`;
        return `### ${anchor}${h.startLine ? ` (行 ${h.startLine})` : ''}\n路径: ${h.notePath}\n片段: ${h.snippet}`;
      })
      .join('\n\n');
    const dirTree = retrieval.includeDirTree ? await this.buildDirOverview(kb.rootPath, kbId) : '';
    const fullDirContext = await this.maybeReadFullDir(kb.rootPath, kbId, question, hits);
    const parts: string[] = [];
    if (dirTree) parts.push(dirTree);
    if (fullDirContext) parts.push(`# 目录整体内容（与问题强相关）\n${fullDirContext}`);
    parts.push(`# 关键词检索片段（top ${hits.length}）\n${hitContext || '（未检索到与问题关键词精确匹配的片段）'}`);
    return parts.join('\n\n');
  }

  /**
   * 多轮问答：在 ask 的检索上下文基础上，把历史 turns 作为对话上下文拼接，
   * 支撑「建议→确认→执行」等需要延续前文的多轮场景（见 doc/AI调用重构技术方案.md §4.2）。
   */
  async askWithHistory(
    kbId: string | undefined,
    history: { role: 'user' | 'assistant'; text: string }[],
    question: string,
    opts?: { templateDirIds?: string[] }
  ): Promise<{ text: string; refs: AIRefHit[] }> {
    const historyBlock = history.length
      ? `\n\n# 此前的对话历史（请基于上文继续，不要重复已给建议）\n${history
          .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.text}`)
          .join('\n')}`
      : '';
    if (!kbId) {
      // 无知识库上下文时，仅做纯多轮对话（仍注入画像若有）
      const sys0 = await this.systemWithProfile(undefined, `请基于以下历史继续对话：${historyBlock}`);
      return { text: await this.chat(question, sys0), refs: [] };
    }
    const kb = getKB(kbId);
    if (!kb) {
      const sys0 = await this.systemWithProfile(kbId, `请基于以下历史继续对话：${historyBlock}`);
      return { text: await this.chat(question, sys0), refs: [] };
    }
    const { hits, refs } = await retrieve(kbId, question, { templateDirIds: opts?.templateDirIds, topK: 12 });
    const hitContext = hits
      .map((h) => {
        const anchor = h.heading ? `[[${h.noteName}#${h.heading}]]` : `[[${h.noteName}]]`;
        return `### ${anchor}${h.startLine ? ` (行 ${h.startLine})` : ''}\n路径: ${h.notePath}\n片段: ${h.snippet}`;
      })
      .join('\n\n');
    const dirTree = await this.buildDirOverview(kb.rootPath, kbId);
    const fullDirContext = await this.maybeReadFullDir(kb.rootPath, kbId, question, hits);
    const extra = `${dirTree}\n\n${fullDirContext ? `# 目录整体内容（与问题强相关）\n${fullDirContext}\n\n` : ''}# 关键词检索片段（top ${hits.length}）\n${hitContext || '（未检索到与问题关键词精确匹配的片段）'}\n\n回答要求：\n- 基于【目录结构 + 检索片段 + 此前后文】回答，引用具体笔记用 [[笔记名]]\n- 若用户是在确认/采纳上一轮建议，请直接基于前文执行，不要重新罗列建议${historyBlock}`;
    const sys = await this.systemWithProfile(kbId, extra);
    return { text: await this.chat(question, sys), refs };
  }

  /**
   * 流式多轮问答（方案 §三.1）：检索上下文一次性得到，正文逐 token 流式返回。
   * yield 首片即附带 refs（引用溯源），末片可能附带 usage。
   *
   * 定位：**仅供 AIHub.runStream 内部调用**（ask 技能的流式分支）。
   * 渲染层的流式入口统一为 hubRunStream，不得直接调用本方法，
   * 否则会绕过会话挂载、用量埋点与画像抽取（doc/AI智能管家重构方案.md §5.1 P0-3）。
   */
  async *askStream(
    kbId: string | undefined,
    history: { role: 'user' | 'assistant'; text: string }[],
    question: string,
    opts?: { templateDirIds?: string[]; signal?: AbortSignal }
  ): AsyncGenerator<{ delta: string; refs?: AIRefHit[]; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const historyBlock = history.length
      ? `\n\n# 此前的对话历史（请基于上文继续，不要重复已给建议）\n${history
          .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.text}`)
          .join('\n')}`
      : '';
    let refs: AIRefHit[] = [];
    let sys = await this.systemWithProfile(kbId, historyBlock);
    if (kbId) {
      const kb = getKB(kbId);
      if (kb) {
        const { hits, refs: retrieved } = await retrieve(kbId, question, { templateDirIds: opts?.templateDirIds, topK: 12 });
        refs = retrieved;
        const hitContext = hits
          .map((h) => {
            const anchor = h.heading ? `[[${h.noteName}#${h.heading}]]` : `[[${h.noteName}]]`;
            return `### ${anchor}${h.startLine ? ` (行 ${h.startLine})` : ''}\n路径: ${h.notePath}\n片段: ${h.snippet}`;
          })
          .join('\n\n');
        const dirTree = await this.buildDirOverview(kb.rootPath, kbId);
        const fullDirContext = await this.maybeReadFullDir(kb.rootPath, kbId, question, hits);
        const extra = `${dirTree}\n\n${fullDirContext ? `# 目录整体内容（与问题强相关）\n${fullDirContext}\n\n` : ''}# 关键词检索片段（top ${hits.length}）\n${hitContext || '（未检索到与问题关键词精确匹配的片段）'}\n\n回答要求：\n- 基于【目录结构 + 检索片段 + 此前后文】回答，引用具体笔记用 [[笔记名]]\n- 若用户是在确认/采纳上一轮建议，请直接基于前文执行，不要重新罗列建议${historyBlock}`;
        sys = await this.systemWithProfile(kbId, extra);
      }
    }
    let first = true;
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    for await (const chunk of this.streamChat(question, sys, { signal: opts?.signal })) {
      if (chunk.usage) usage = chunk.usage;
      yield { delta: chunk.delta, refs: first ? refs : undefined };
      first = false;
    }
    if (usage) yield { delta: '', usage };
  }

  /**
   * 构建知识库目录总览（用于作为 system prompt 的一部分）
   * 输出格式：
   *   # 知识库目录结构
   *   ## 00 灵感库（5 篇）
   *     - 笔记1
   *     - 笔记2
   *     - 笔记3
   *     ...
   *     README 摘要: xxx
   */
  private async buildDirOverview(rootPath: string, kbId: string): Promise<string> {
    try {
      const dirents = await fs.readdir(rootPath, { withFileTypes: true });
      const dirs: string[] = [];
      for (const d of dirents) {
        if (d.isDirectory() && !d.name.startsWith('.')) dirs.push(d.name);
      }
      dirs.sort();
      const lines: string[] = ['# 知识库目录结构（用于全局理解）'];
      for (const dir of dirs) {
        const dirPath = join(rootPath, dir);
        const files = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
        const notes = files.filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.md') && !f.name.startsWith('.'));
        const readme = files.find((f) => f.isFile() && f.name === '.README.md');
        let readmeExcerpt = '';
        if (readme) {
          try {
            const content = await fs.readFile(join(dirPath, '.README.md'), 'utf-8');
            // 取 README 标题 + 简介（去除 markdown 标记）
            const plain = content
              .replace(/^#+\s*/gm, '')
              .replace(/[*_`~]/g, '')
              .split('\n')
              .filter((l) => l.trim())
              .slice(0, 3)
              .join(' / ');
            readmeExcerpt = plain.slice(0, 200);
          } catch {}
        }
        const noteNames = notes.slice(0, 30).map((n) => `  - ${n.name.replace(/\.md$/i, '')}`).join('\n');
        const more = notes.length > 30 ? `\n  - …（还有 ${notes.length - 30} 篇）` : '';
        lines.push(`\n## ${dir}（共 ${notes.length} 篇）`);
        if (readmeExcerpt) lines.push(`  简介: ${readmeExcerpt}`);
        if (noteNames) {
          lines.push(noteNames);
          if (more) lines.push(more);
        }
      }
      if (lines.length === 1) {
        return '# 知识库目录结构\n（知识库暂无目录）';
      }
      return lines.join('\n');
    } catch (e) {
      return `# 知识库目录结构\n（读取失败: ${String(e)}）`;
    }
  }

  /**
   * 检测问题是否指向某个目录的整体内容（如"帮我归纳 XX 目录下所有项目进展"）
   * 命中则读取该目录下所有笔记的完整内容（限制总长度）
   */
  private async maybeReadFullDir(rootPath: string, kbId: string, question: string, hits: any[]): Promise<string> {
    try {
      // 提取问题中提到的目录关键词（如 "01 项目"、"04 归档"）
      const dirMentions: string[] = [];
      // 1) 匹配 "XX 数字+名" 模式，如 "01 项目"、"04 归档"
      const dirPattern = /(\d{2}\s*[一-龥a-zA-Z]{1,8})/g;
      const matches = [...question.matchAll(dirPattern)].map((m) => m[1].trim());
      dirMentions.push(...matches);
      // 2) 匹配 hits 中涉及的目录路径前缀
      const hitDirs = new Set<string>();
      for (const h of hits) {
        const dir = h.notePath.split('/')[0];
        if (dir) hitDirs.add(dir);
      }
      // 3) 匹配整目录归纳意图的关键词
      const aggregateIntents = /归纳|总结|汇总|整体|全部|所有|进展|情况|如何|怎么|合理|建议/i.test(question);

      if (!aggregateIntents && dirMentions.length === 0) return '';

      // 选取目标目录
      const targetDirs = new Set<string>();
      for (const d of dirMentions) {
        // 模糊匹配：包含"01 项目"中的"项目"或"01"
        const numMatch = d.match(/^(\d{2})/);
        const nameMatch = d.replace(/^\d{2}\s*/, '');
        const dirents = await fs.readdir(rootPath, { withFileTypes: true });
        for (const ent of dirents) {
          if (!ent.isDirectory()) continue;
          if (numMatch && ent.name.startsWith(numMatch[1])) targetDirs.add(ent.name);
          else if (nameMatch && ent.name.includes(nameMatch)) targetDirs.add(ent.name);
        }
      }
      // 若用户问的是整体归纳且没有指定目录，取第一个有内容的目录
      if (targetDirs.size === 0 && aggregateIntents) {
        const dirents = await fs.readdir(rootPath, { withFileTypes: true });
        for (const ent of dirents) {
          if (ent.isDirectory() && !ent.name.startsWith('.')) {
            targetDirs.add(ent.name);
            break;
          }
        }
      }
      // 加入 hits 命中的目录
      for (const d of hitDirs) targetDirs.add(d);

      if (targetDirs.size === 0) return '';

      const sections: string[] = [];
      let totalLen = 0;
      const MAX = 12_000; // 避免上下文超限
      for (const dir of targetDirs) {
        const dirPath = join(rootPath, dir);
        const files = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
        const notes = files.filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.md') && !f.name.startsWith('.'));
        if (notes.length === 0) continue;
        sections.push(`\n## 目录「${dir}」全部笔记（${notes.length} 篇）`);
        for (const n of notes) {
          try {
            const content = await fs.readFile(join(dirPath, n.name), 'utf-8');
            const stripped = content
              .replace(/```[\s\S]*?```/g, '[代码]')
              .replace(/^#+\s*/gm, '')
              .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
              .replace(/[*_`~]+/g, '')
              .trim();
            const block = `\n### [[${n.name.replace(/\.md$/i, '')}]]\n${stripped}`;
            if (totalLen + block.length > MAX) {
              sections.push(`\n### [[${n.name.replace(/\.md$/i, '')}]]\n（内容过长已截断）`);
              continue;
            }
            sections.push(block);
            totalLen += block.length;
          } catch {}
        }
      }
      return sections.join('\n');
    } catch (e) {
      return '';
    }
  }

  /**
   * 摘要：纯文本（不使用任何 markdown 符号），不超过 250 字，
   * 不输出"好的，这是..."等 AI 回复开场语，只输出摘要正文本身。
   */
  async summarize(kbId: string, notePath: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return '';
    const content = await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => '');
    const sys = `${BASE_SYSTEM}\n\n请为以下笔记生成一段中文摘要，要求：\n1) 严格使用纯文本，禁止使用任何 Markdown 符号（如 #、*、-、>、代码块、加粗等）。\n2) 字数不超过 250 字。\n3) 直接输出摘要正文，不要任何开场语、解释、标题或前缀，例如不要出现"好的""以下是""摘要："等。`;
    const raw = await this.chat(content.slice(0, 4000), sys);
    // 后处理
    return this.sanitizeSummary(raw);
  }

  /**
   * 阶段 B：用户画像抽取。给定本轮 user/assistant 文本与当前画像，
   * 让模型输出「相对当前画像的增量」。失败/未配置时返回空结果（绝不影响主对话）。
   */
  async extractProfile(
    kbId: string,
    userText: string,
    assistantText: string,
    currentProfile: unknown
  ): Promise<ProfileExtractResult> {
    const kb = getKB(kbId);
    if (!kb) return { updates: [], confidence: 0 };
    const sys = `${BASE_SYSTEM}\n\n你是「用户画像抽取器」。给定【当前画像】与【一次交互（用户提问 + AI 回答）】，`
      + '只输出相对当前画像的【增量】更新（新增/增强证据/修正），不要重复已有内容。\n'
      + '严格只输出 JSON，不要任何解释或 Markdown 代码块。结构：\n'
      + '{\n'
      + '  "updates": [ { "field": "interests"|"expertise"|"preferences"|"basics"|"goals"|"persona"|"recentFocus", "op": "add"|"merge"|"set"|"patch", "value": <对应结构> } ],\n'
      + '  "personaPatch": "可选，一句话补充画像简述",\n'
      + '  "confidence": 0~1\n'
      + '}\n'
      + '字段取值约定：\n'
      + '- interests.value = [{ "name": "主题", "weight": 0.2, "evidence": "证据", "source": "chat" }]\n'
      + '- expertise.value = { "领域": 0~5 }\n'
      + '- preferences.value = { "tone": "concise|detailed|socratic|casual", "depth": "intro|intermediate|expert", "proactivity": "passive|balanced|proactive" }（仅在交互中明显体现出偏好时才输出）\n'
      + '- basics.value = { "role": "...", "domains": [...], "goals": [...] }\n'
      + '- goals.value = ["目标1","目标2"]\n'
      + '- recentFocus.value = [{ "topic": "主题", "weight": 0.2 }]\n'
      + '不要输出与当前画像完全一致的内容；无新增时 updates 为空数组、confidence 取 0。';
    const prompt =
      `【当前画像】\n${JSON.stringify(currentProfile).slice(0, 2000)}\n\n` +
      `【用户提问】\n${userText.slice(0, 1500)}\n\n` +
      `【AI 回答】（用于判断用户关注点与深度）\n${assistantText.slice(0, 1500)}\n\n` +
      `请输出画像增量 JSON：`;
    try {
      const raw = await this.chat(prompt, sys);
      const json = this.stripJson(raw);
      const parsed = JSON.parse(json) as { updates?: unknown[]; personaPatch?: string; confidence?: number };
      return {
        updates: (Array.isArray(parsed.updates) ? parsed.updates : []) as ProfileExtractResult['updates'],
        personaPatch: parsed.personaPatch,
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0
      };
    } catch {
      return { updates: [], confidence: 0 };
    }
  }

  /** 抽取 JSON（剥离可能的代码块 / 前后文本） */
  private stripJson(raw: string): string {
    let s = raw.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    return s;
  }

  /**
   * 摘要清洗：剥离 markdown 符号、压缩空白、限制字数。
   */
  private sanitizeSummary(text: string): string {
    if (!text) return '';
    let s = text;
    // 去除围栏代码块与行内代码
    s = s.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1');
    // 去除标题 / 引用 / 列表 / 强调 / 链接 / 图片
    s = s.replace(/^#{1,6}\s*/gm, '');
    s = s.replace(/^>\s?/gm, '');
    s = s.replace(/^\s*[-*+]\s+/gm, '');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/\*([^*]+)\*/g, '$1');
    s = s.replace(/__([^_]+)__/g, '$1');
    s = s.replace(/_([^_]+)_/g, '$1');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1');
    // 去除常见 AI 开场语
    s = s.replace(
      /^\s*(好的[,，]?\s*|以下是[^。]*[：:]\s*|摘要[：:]\s*|这是[^。]*[：:]\s*|下面[^。]*[：:]\s*|以下为[^。]*[：:]\s*|好的[,，]?这是[^。]*[。.]\s*)/i,
      ''
    );
    // 压缩空白
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /**
   * 自动生成标签
   * 输出 3~6 个简短中文/英文标签（与笔记 frontmatter tags 语义一致）。
   * 返回空数组或非 JSON 时回退到文本解析（按行/逗号）。
   */
  async generateTags(kbId: string, notePath: string): Promise<string[]> {
    const kb = getKB(kbId);
    if (!kb) return [];
    const content = await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => '');
    if (!content) return [];
    const sys = `${BASE_SYSTEM}\n\n请基于以下笔记内容生成 3~6 个简洁标签（每项 1~4 个词），用于知识管理。\n严格只输出 JSON 数组，不要任何解释，例如：["标签1","标签2"]`;
    const raw = (await this.chat(content.slice(0, 4000), sys)) || '';
    // 优先解析 JSON 数组
    const m = raw.match(/\[[\s\S]*?\]/);
    if (m) {
      try {
        const arr = JSON.parse(m[0]);
        if (Array.isArray(arr)) {
          return arr
            .map((x) => String(x).trim())
            .filter((x) => x && x.length <= 20)
            .slice(0, 6);
        }
      } catch {}
    }
    // 退化解析：按行 / 逗号 / # 号
    return raw
      .split(/[\n,，#]/)
      .map((s) => s.replace(/^[\s\-*·•]+|[\s"']+$/g, '').trim())
      .filter((s) => s && s.length <= 20)
      .slice(0, 6);
  }

  /**
   * 归纳推荐（目录）
   */
  async suggestDir(kbId: string, notePath: string): Promise<DirSuggestion[]> {
    const kb = getKB(kbId);
    if (!kb) return [];
    const content = await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => '');
    const metaPath = join(kb.rootPath, '.kb_template.json');
    let meta: { dirs: { id: string; name: string; readme?: string }[] } | null = null;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    } catch {}
    if (!meta) return [];
    // 读取各目录 README
    const dirInfo = await Promise.all(
      meta.dirs.map(async (d) => {
        const realDir = `${d.id} ${d.name}`;
        const readme = await fs
          .readFile(join(kb.rootPath, realDir, '.README.md'), 'utf-8')
          .catch(() => '');
        return { id: d.id, name: d.name, realDir, readme };
      })
    );
    const aiConfig = await this.getAIConfigContent(kbId);
    const sys = `${BASE_SYSTEM}\n\n你将根据用户知识库的「目录使用说明 + AI_CONFIG + 笔记内容」推荐最合适的归档目录。\n\n# AI_CONFIG\n${aiConfig}\n\n# 目录说明\n${dirInfo
      .map((d) => `## ${d.realDir}\n${d.readme.slice(0, 600)}`)
      .join('\n\n')}\n\n# 输出格式（严格 JSON）\n[{\n  "dirId": "00" | "01" | ...,\n  "dirName": "...",\n  "reason": "一句话推荐理由",\n  "confidence": 0.0~1.0\n}]，最多 3 个推荐。`;
    const user = `# 待归档笔记\n${content.slice(0, 2000)}`;
    const raw = await this.chat(user, sys);
    return this.parseDirSuggestions(raw, dirInfo);
  }

  /**
   * 语音转写（ASR）。当前为占位实现：优先尝试接入本地/云端 STT，未配置时返回提示文本，
   * 保证「录入→保存→转写→生成笔记」链路可跑通并可平滑扩展。
   * 接入真实 ASR 时，只需在此处调用对应服务并 return 纯文本。
   */
  async transcribe(audioAbs: string): Promise<string> {
    const stat = await fs.stat(audioAbs).catch(() => null);
    const sizeKB = stat ? Math.round(stat.size / 1024) : 0;
    // TODO: 接入真实 ASR（本地 Whisper / 云端 STT）。当前返回占位文本，便于流程验证。
    return `（语音转写占位文本）\n音频文件：${audioAbs}\n大小：${sizeKB} KB\n\n说明：已在多媒体技术方案中规划 ASR 接入点，配置语音识别服务后此处返回真实转写内容。`;
  }

  /**
   * 根据音频相对路径与转写文本，生成对应的文本笔记（同 hash 命名，便于一一对应）。
   * 写入 KB 根 .assets/audio/<hash>.transcript.md，并自动入库（syncIndex）。
   * Front Matter 遵循标准，且扩展 source 字段记录音频来源。
   */
  async generateTranscriptNote(kbId: string, audioRelPath: string, text: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) throw new Error('KB 不存在: ' + kbId);
    // audioRelPath 形如 .assets/audio/<hash>.m4a，取 hash 作为转写笔记名
    const baseName = audioRelPath.split('/').pop() || '';
    const hash = baseName.replace(/\.[^.]+$/, '');
    const transcriptPath = `.assets/audio/${hash}.transcript.md`;
    const abs = safeJoin(kb.rootPath, transcriptPath);
    const now = new Date().toISOString().slice(0, 10);
    const title = `语音转写 ${now}`;
    const body = `# ${title}\n\n${text}\n`;
    const withFm = writeFrontmatter(body, {
      title,
      summary: text.slice(0, 80).replace(/\n+/g, ' ').trim(),
      tags: ['语音', '转写'],
      extra: { source: `audio:${audioRelPath}` }
    });
    await atomicWrite(abs, withFm);
    await fsService.syncIndex(kbId, transcriptPath);
    eventBus.emit('fsChange', { kbId, type: 'change', path: transcriptPath });
    return transcriptPath;
  }

  private parseDirSuggestions(raw: string, dirs: { id: string; name: string; realDir: string }[]): DirSuggestion[] {
    const m = /```json\s*([\s\S]+?)\s*```/.exec(raw) || /(\[.*?\])/s.exec(raw);
    if (!m) return [];
    try {
      const arr = JSON.parse(m[1]) as { dirId: string; dirName: string; reason: string; confidence: number }[];
      return arr.slice(0, 3).map((a) => {
        const dir = dirs.find((d) => d.id === a.dirId);
        return {
          dirId: a.dirId,
          dirName: a.dirName || dir?.name || a.dirId,
          dirPath: dir?.realDir || a.dirId,
          reason: a.reason || '',
          confidence: Math.max(0, Math.min(1, a.confidence ?? 0.5))
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * 快速笔记：一次性产出 标题 / 摘要 / 归属目录 / 标签 / 双向链接
   * 供主菜单「快速笔记」使用——用户输入一段内容，AI 自动整理入库。
   */
  async quickNote(kbId: string, content: string, opts?: { dirId?: string }): Promise<QuickNoteResult> {
    const kb = getKB(kbId);
    if (!kb) throw new Error('知识库不存在');
    const text = content.trim();
    if (!text) throw new Error('内容为空');

    // 1) 目录说明（用于归属判断 + 链接推荐）
    const metaPath = join(kb.rootPath, '.kb_template.json');
    let meta: { dirs: { id: string; name: string; readme?: string }[] } | null = null;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    } catch {}
    const dirInfo =
      meta?.dirs.map((d) => {
        const realDir = `${d.id} ${d.name}`;
        return { id: d.id, name: d.name, realDir, readme: d.readme || '' };
      }) ?? [];

    const aiConfig = await this.getAIConfigContent(kbId);

    // 2) 链接检测：内容含外部链接时，抓取正文供 AI 了解内容后再归类
    const urls = this.extractUrls(text);
    let fetched: { url: string; text: string }[] = [];
    if (urls.length) {
      const picked = urls.slice(0, 3);
      const results = await Promise.allSettled(picked.map((u) => this.fetchUrlText(u)));
      fetched = results
        .map((r, i) => (r.status === 'fulfilled' ? { url: picked[i], text: r.value } : null))
        .filter((x): x is { url: string; text: string } => !!x && !!x.text);
    }
    const hasLink = urls.length > 0;

    // 3) 候选链接（基于内容检索）
    const candidates = await searchService.query(kbId, text.slice(0, 200), { limit: 15 });

    // 4) 仅当用户显式指定目录时才跳过推断；外部链接不再固定目录，
    //    而是让 AI 基于抓取到的链接正文，对照知识库目录灵活归类
    //    （外部链接通常属于资源范畴，但应以内容语义为主选择最合适的目录）。
    const forcedDirId = opts?.dirId;
    const dirSection =
      forcedDirId && dirInfo.find((d) => d.id === forcedDirId)
        ? `用户已指定归属目录：${dirInfo.find((d) => d.id === forcedDirId)!.realDir}，无需重新推断，dirId 必须填 "${forcedDirId}"。`
        : `# 知识库目录（用于推断归属）\n${dirInfo
            .map((d) => `## ${d.realDir}\n${(d.readme || '').slice(0, 400)}`)
            .join('\n\n')}`;

    const sys = `${BASE_SYSTEM}\n\n你是一个知识整理助手。用户提交了一段原始内容（可能包含外部链接），请一次性整理为结构化笔记草稿。\n\n# 基本原则\n1. 忠实于原文，不编造事实。\n2. 归属目录必须从给定目录中选最合适的一个（请先理解抓取的链接/网页正文内容，再对照目录语义判断；外部链接通常偏向资源范畴，但仍应以内容主题为主，不要机械归入「外部资源」）。\n3. 标签 2-5 个，精炼、可复用。\n4. 双向链接从候选笔记中挑选最相关的 2-4 个，用笔记名（不含 .md）。\n5. 若提供了抓取的网页/链接正文，请基于其内容归纳要点，并注明来源性质（如分享对话、产品介绍等）。\n\n# AI_CONFIG\n${aiConfig}\n\n${dirSection}\n\n# 候选相关笔记（用于双向链接）\n${candidates
      .slice(0, 10)
      .map((c) => `- ${c.noteName}（${c.notePath}）`)
      .join('\n')}\n\n# 输出格式（严格 JSON，不要多余文字）\n{\n  "title": "一句话标题",\n  "summary": "200 字内摘要，概括要点",\n  "dirId": "${dirInfo.map((d) => d.id).join('|') || '00'}",\n  "dirName": "归属目录真实名（如 01 项目）",\n  "tags": ["标签1", "标签2"],\n  "links": ["相关笔记名1", "相关笔记名2"]\n}`;

    let user = `# 用户原始内容\n${text.slice(0, 6000)}`;
    if (fetched.length) {
      user +=
        `\n\n# 抓取的外部链接正文（用于归纳与归类）\n` +
        fetched.map((f) => `## 链接：${f.url}\n${f.text.slice(0, 4000)}`).join('\n\n');
    }
    const raw = await this.chat(user, sys);
    const candidateNames = new Set(candidates.map((c) => c.noteName.replace(/\.md$/i, '')));
    return this.parseQuickNote(raw, dirInfo, forcedDirId, urls, fetched, candidateNames);
  }

  /** 从文本中提取 http(s) 链接 */
  private extractUrls(text: string): string[] {
    const re = /https?:\/\/[^\s，。、）)】\]]+/gi;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.add(m[0]);
    return [...out];
  }

  /** 抓取网页正文（去除 HTML 标签、压缩空白），带超时与降级 */
  private async fetchUrlText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ForgeNote/1.0)' },
        redirect: 'follow'
      });
      if (!res.ok) return '';
      const html = await res.text();
      let txt = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<head[\s\S]*?<\/head>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"');
      txt = txt.replace(/\s+/g, ' ').trim();
      // 保留完整正文（仅防极端超长），供笔记落盘使用
      return txt.slice(0, 30000);
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  private parseQuickNote(
    raw: string,
    dirInfo: { id: string; name: string; realDir: string }[],
    forcedDirId?: string,
    sourceUrls: string[] = [],
    sourceTexts: { url: string; text: string }[] = [],
    candidateNames: Set<string> = new Set()
  ): QuickNoteResult {
    const m = /```json\s*([\s\S]+?)\s*```/.exec(raw) || /(\{[\s\S]+\})/s.exec(raw);
    const fallback: QuickNoteResult = {
      title: '快速笔记',
      summary: '',
      dirId: forcedDirId || dirInfo[0]?.id || '00',
      dirName: dirInfo[0]?.realDir || '00 未分类',
      tags: [],
      links: [],
      sourceUrls,
      sourceTexts
    };
    if (!m) return fallback;
    try {
      const obj = JSON.parse(m[1]);
      const dir = dirInfo.find((d) => d.id === (obj.dirId || forcedDirId)) || dirInfo[0];
      return {
        title: String(obj.title || '快速笔记').slice(0, 80),
        summary: String(obj.summary || '').slice(0, 600),
        dirId: dir?.id || fallback.dirId,
        dirName: dir?.realDir || obj.dirName || fallback.dirName,
        tags: Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 8) : [],
        // 双向链接仅保留知识库中真实存在的笔记名，过滤 AI 幻觉产生的断链
        links: (() => {
          const raw: unknown[] = Array.isArray(obj.links) ? (obj.links as unknown[]) : [];
          return raw
            .map((x) => String(x))
            .filter((l: string) => candidateNames.has(l.replace(/\.md$/i, '')))
            .slice(0, 6);
        })(),
        sourceUrls,
        sourceTexts
      };
    } catch {
      return fallback;
    }
  }

  /**
   * 链接推荐
   */
  async suggestLinks(kbId: string, notePath: string): Promise<LinkInfo[]> {
    const kb = getKB(kbId);
    if (!kb) return [];
    const content = await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => '');
    const candidates = await searchService.query(kbId, previewLine(content, 200), { limit: 20 });
    // 过滤掉自身与已有的链接
    const existing = new Set(extractWikiLinks(content).map((l) => l.replace(/\.md$/i, '')));
    const filtered = candidates.filter((c) => c.notePath !== notePath && !existing.has(c.noteName.replace(/\.md$/i, '')));
    const aiConfig = await this.getAIConfigContent(kbId);
    const sys = `${BASE_SYSTEM}\n\n# 模板流向规则（来自 AI_CONFIG）\n${aiConfig}\n\n根据用户笔记与候选笔记列表，推荐 3-5 条可建立的双向链接。\n\n# 输出格式（严格 JSON）\n[{\n  "target": "笔记名（不含 .md）",\n  "kind": "flow" | "semantic",\n  "reason": "一句话理由",\n  "score": 0.0~1.0\n}]`;
    const user = `# 当前笔记\n${content.slice(0, 1500)}\n\n# 候选笔记（已去重）\n${filtered
      .slice(0, 15)
      .map((c) => `- ${c.noteName} (${c.notePath})\n  片段: ${c.snippet}`)
      .join('\n')}`;
    const raw = await this.chat(user, sys);
    return this.parseLinkSuggestions(raw, filtered);
  }

  private parseLinkSuggestions(raw: string, candidates: import('@shared/types').SearchResult[]): LinkInfo[] {
    const m = /```json\s*([\s\S]+?)\s*```/.exec(raw) || /(\[.*?\])/s.exec(raw);
    if (!m) {
      // 降级：取 top 3 semantic
      return candidates.slice(0, 3).map((c) => ({
        target: c.noteName.replace(/\.md$/i, ''),
        targetPath: c.notePath,
        kind: 'semantic' as const,
        reason: '内容相关',
        score: c.score / 10
      }));
    }
    try {
      const arr = JSON.parse(m[1]) as { target: string; kind: 'flow' | 'semantic'; reason: string; score: number }[];
      return arr.slice(0, 5).map((a) => {
        const c = candidates.find((x) => x.noteName.replace(/\.md$/i, '') === a.target || x.notePath === a.target);
        return {
          target: a.target,
          targetPath: c?.notePath,
          kind: a.kind,
          reason: a.reason,
          score: a.score
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * 锻造知识卡片
   */
  async forgeCard(kbId: string, notePath: string): Promise<CardDraft> {
    const kb = getKB(kbId);
    if (!kb) throw new Error('知识库不存在');
    const content = await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => '');
    const aiConfig = await this.getAIConfigContent(kbId);
    const sys = `${BASE_SYSTEM}\n\n# 知识卡片四铁律\n1. 原子性：一卡一知识点\n2. 可行动：能指导具体动作\n3. 可证伪：有明确判断标准\n4. 诚实：不夸大不编造\n\n# AI_CONFIG\n${aiConfig}\n\n请将以下灵感笔记提炼为知识卡片，严格按 JSON 输出：\n{\n  "title": "...",\n  "status": "L1" | "L2" | "L3",\n  "coreIdea": "一句话核心观点",\n  "details": "详细阐述（原子化）",\n  "actionable": ["可行动项1", "..."],\n  "verification": "验证标准（可证伪）",\n  "relatedLinks": ["相关笔记名"],\n  "suggestedTarget": { "dirId": "01|02|06", "dirName": "...", "reason": "..." }\n}`;
    const user = `# 原灵感笔记\n${content}`;
    const raw = await this.chat(user, sys);
    const m = /```json\s*([\s\S]+?)\s*```/.exec(raw) || /(\{[\s\S]+\})/.exec(raw);
    if (!m) throw new Error('AI 返回格式错误');
    const obj = JSON.parse(m[1]);
    return {
      title: obj.title || '未命名卡片',
      status: obj.status || 'L1',
      source: `[[${notePath}]]`,
      createdAt: new Date().toISOString().slice(0, 10),
      coreIdea: obj.coreIdea || '',
      details: obj.details || '',
      actionable: obj.actionable || [],
      verification: obj.verification || '',
      relatedLinks: obj.relatedLinks || [],
      suggestedTarget: obj.suggestedTarget || { dirId: '02', dirName: '资产', reason: '默认建议' }
    };
  }

  /**
   * 插入链接（用户确认后调用）
   */
  async insertLinks(kbId: string, notePath: string, targets: string[]): Promise<void> {
    const kb = getKB(kbId);
    if (!kb || targets.length === 0) return;
    const abs = safeRead(kb.rootPath, notePath);
    const content = await fs.readFile(abs, 'utf-8');
    // 在文末追加「## 相关链接」段（若不存在）
    let updated = content;
    const section = '## 相关链接';
    if (!updated.includes(section)) {
      updated = updated.trimEnd() + `\n\n${section}\n\n`;
    }
    const links = targets.map((t) => `- [[${t}]]`).join('\n');
    if (!updated.endsWith('\n')) updated += '\n';
    updated += links + '\n';
    await fs.writeFile(abs, updated, 'utf-8');
    const newOutlinks = extractWikiLinks(updated);
    linkIndex.updateOutlinks(kbId, notePath, newOutlinks);
  }

  /**
   * 围绕单篇笔记提问：将该篇笔记内容作为上下文喂给大模型
   */
  async askAboutNote(kbId: string, notePath: string, question: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return '';
    const content = await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => '');
    const aiConfig = await this.getAIConfigContent(kbId);
    const sys = `${BASE_SYSTEM}\n\n# 当前笔记（作为对话上下文，请勿修改原文）\n${content.slice(0, 6000)}\n\n# AI_CONFIG\n${aiConfig}\n\n回答要求：\n- 优先基于上述笔记内容回答，不编造本地资料中不存在的信息\n- 引用时用 [[笔记名]] 语法\n- 若用户请求分析、延伸、对比等任务而本地资料不足，可结合通用知识进行合理推演与补充，但须明确区分本地资料与通用知识推断，并提醒用户核实关键数据`;
    return this.chat(question, sys);
  }

  /**
   * 依据 AI 对话回复，结合当前笔记全文及其格式，完善并重写整篇笔记。
   * currentContent 可选：传入编辑器最新内容（避免未保存丢失）；缺省时读盘。
   */
  async refineNote(kbId: string, notePath: string, aiReply: string, currentContent?: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return currentContent || '';
    const base = currentContent ?? (await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => ''));
    const aiConfig = await this.getAIConfigContent(kbId);
    const sys = `${BASE_SYSTEM}\n\n# 任务\n你是笔记完善助手。下面是一篇现有笔记及其已有格式（标题层级、列表、引用、表格、粗体/斜体等 Markdown 语法）。\n请结合「AI 对话回复」中的要点，对整篇笔记进行完善、补充与整合，并输出完善后的【完整笔记全文】。\n要求：\n- 严格保留原文的结构与 Markdown 格式风格\n- 将 AI 回复中有价值的内容自然融入对应章节，不要简单堆砌到末尾\n- 仅输出完善后的笔记全文，不要任何解释、不要使用代码块围栏\n- 若相关内容本地资料不足，可结合通用知识进行合理推演与补充，但须在对应位置明确标注「（基于通用知识，需核实）」\n\n# 现有笔记全文\n${base.slice(0, 8000)}\n\n# AI_CONFIG\n${aiConfig}`;
    const refined = await this.chat(aiReply, sys);
    // 去除模型可能误加的代码块围栏与首尾空白
    const cleaned = refined
      .replace(/^```(?:markdown)?\s*\n?/i, '')
      .replace(/\n?```\s*$/, '')
      .trim();
    return cleaned;
  }

  /** 阶段 B：用 refiner Agent 人格完善笔记（替代 BASE_SYSTEM 的 refineNote） */
  async refineNoteWithAgent(kbId: string, notePath: string, aiReply: string, currentContent?: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return currentContent || '';
    const base = currentContent ?? (await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => ''));
    const sys = await composeAgentSystem(agentRegistry.get('refiner')!, {
      kbId,
      input: { text: aiReply },
      extra: {}
    });
    const refined = await this.chat(aiReply, sys);
    const cleaned = refined
      .replace(/^```(?:markdown)?\s*\n?/i, '')
      .replace(/\n?```\s*$/, '')
      .trim();
    return cleaned;
  }

  /** 阶段 B：用 card-smith Agent 人格锻造知识卡片（返回结构化对象） */
  async forgeCardWithAgent(kbId: string, text: string): Promise<{ title: string; body: string; links: string[]; hook: string; reuse: string }> {
    const sys = await composeAgentSystem(agentRegistry.get('card-smith')!, {
      kbId,
      input: { text },
      extra: {}
    });
    const merged = `${sys}\n\n# 待锻造内容\n${text}\n\n请严格以 JSON 输出：{"title":..., "body":..., "links":[...], "hook":..., "reuse":...}`;
    const raw = await this.chat(merged, sys);
    try {
      const json = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
      return {
        title: json.title || '未命名卡片',
        body: json.body || '',
        links: Array.isArray(json.links) ? json.links : [],
        hook: json.hook || '',
        reuse: json.reuse || ''
      };
    } catch {
      return { title: '未命名卡片', body: raw, links: [], hook: '', reuse: '' };
    }
  }

  /**
   * 智能体对话：模型可主动调用知识库 MCP 工具（检索/读写/诊断）。
   * 实现 ReAct 循环：模型生成 tool_calls → 执行 → 结果回灌 → 再次推理，直到无 tool_calls。
   * 见 doc/AI调用重构技术方案.md §6。
   */
  async agentChat(
    kbId: string | undefined,
    sys: string,
    user: string,
    opts?: {
      history?: { role: 'user' | 'assistant'; text: string }[];
      onActivity?: (a: ToolActivity) => void;
      /** 是否已获得用户确认（doc/MCP技术实现方案.md §4.2）：未确认时不暴露写类工具 */
      canWrite?: boolean;
      /** 外部 MCP server 暴露的工具（方案 §6.4）。不传时自动读取已启用 MCP。 */
      externalTools?: MCPTool[];
      /** Agent 采样参数覆盖 */
      sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number };
    }
    ): Promise<string> {
      const cfg = await this.getConfig();
      if (!this.isEnabled(cfg)) {
        return '当前未配置 AI 模型，无法启用智能体工具调用。';
      }
      const canWrite = !!opts?.canWrite;
      // 未确认时从工具表中剔除写类工具：模型「看不见」就无法误调用，比提示词约束更可靠
      // 用 allTools()：内置工具 + 插件注册的工具，对模型完全等价
      const tools = allTools().filter((t) => canWrite || !WRITE_TOOLS.has(t.name)).map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema }
      }));
    // 合并外部 MCP server 暴露的工具（方案 §6.4）：默认禁用，设置开启后才出现，实现跨域能力扩展。
    try {
      const ext = opts?.externalTools ?? (await listExternalTools());
      for (const e of ext) tools.push({ type: 'function', function: { name: e.name, description: e.description, parameters: e.input_schema } });
    } catch {
      /* 外部 MCP 不可用不影响本地能力 */
    }
    const messages: any[] = [{ role: 'system', content: sys }];
    for (const h of opts?.history || []) messages.push({ role: h.role, content: h.text });
    messages.push({ role: 'user', content: user });

    const provider = cfg.provider === 'ollama' ? 'ollama' : 'openai';
    const sampling = opts?.sampling;
    const maxRounds = 10;
    for (let round = 0; round < maxRounds; round++) {
      const { content, toolCalls } =
        provider === 'ollama'
          ? await this.callOllamaTools(cfg, messages, tools, sampling)
          : await this.callOpenAITools(cfg, messages, tools, sampling);
      if (toolCalls.length === 0) {
        return content || '（无返回）';
      }
      // 执行工具并回灌
      for (const tc of toolCalls) {
        const args = safeParseArgs(tc.function?.arguments);
        const name = tc.function?.name || '';
        // 外部 MCP 工具走 mcp-client，本地 kb_ 工具走 tool-runtime
        const result = isExternalTool(name)
          ? await executeExternalTool(name, args)
          : await executeTool({ name, args }, { kbId: kbId || '' });
        const activity: ToolActivity = { name, args, result };
        opts?.onActivity?.(activity);
        messages.push({ role: 'assistant', content: content || '', tool_calls: [tc] });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
    return '（已达到最大工具调用轮次）';
  }

  private async callOpenAITools(
    cfg: AIModelConfig,
    messages: any[],
    tools: any[],
    sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number }
  ): Promise<{ content: string; toolCalls: any[] }> {
    const base = cfg.baseUrl || 'https://api.openai.com/v1';
    const body: Record<string, unknown> = { model: cfg.model, messages, tools, temperature: sampling?.temperature ?? 0.3 };
    if (sampling?.top_p !== undefined) body.top_p = sampling.top_p;
    if (sampling?.presence_penalty !== undefined) body.presence_penalty = sampling.presence_penalty;
    if (sampling?.frequency_penalty !== undefined) body.frequency_penalty = sampling.frequency_penalty;
    if (sampling?.max_tokens !== undefined) body.max_tokens = sampling.max_tokens;
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey || ''}` },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`OpenAI 调用失败: ${r.status} ${await r.text()}`);
    const data = (await r.json()) as any;
    const msg = data.choices?.[0]?.message || {};
    return { content: msg.content || '', toolCalls: msg.tool_calls || [] };
  }

  private async callOllamaTools(
    cfg: AIModelConfig,
    messages: any[],
    tools: any[],
    sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number }
  ): Promise<{ content: string; toolCalls: any[] }> {
    const base = cfg.baseUrl || 'http://127.0.0.1:11434';
    const body: Record<string, unknown> = { model: cfg.model, stream: false, messages, tools };
    // Ollama 原生不支持 top_p/presence/frequency/max_tokens；若有温度需求可按需透传 options.temperature
    if (sampling?.temperature !== undefined) body.options = { temperature: sampling.temperature };
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Ollama 调用失败: ${r.status} ${await r.text()}`);
    const data = (await r.json()) as any;
    const msg = data.message || {};
    const toolCalls = (msg.tool_calls || []).map((tc: any, i: number) => ({
      id: `call_${i}`,
      type: 'function',
      function: { name: tc.function?.name, arguments: JSON.stringify(tc.function?.arguments || {}) }
    }));
    return { content: msg.content || '', toolCalls };
  }

  /**
   * 多 Agent 统一执行入口（doc/多Agent技术实现方案.md §3.4）。
   * 根据 agentId 组装 system prompt（人格 + 画像 + 检索 + 附加指引），
   * 用该 Agent 的采样参数调用模型，并触发 postRun（如灵感历史持久化）。
   */
  async runAgent(opts: {
    agentId: string;
    kbId?: string;
    userMessage: string;
    extra?: Record<string, unknown>;
    input?: Record<string, unknown>;
    history?: unknown[];
  }): Promise<string> {
    const agent = agentRegistry.get(opts.agentId);
    if (!agent) throw new Error(`未知 Agent: ${opts.agentId}`);
    const ctx: AgentRunCtx = {
      kbId: opts.kbId,
      input: opts.input ?? { text: opts.userMessage },
      history: opts.history,
      extra: opts.extra
    };
    if (agent.preRun) await agent.preRun(ctx);
    const sys = await composeAgentSystem(agent, ctx);
    const sampling = mergeSampling(agent.sampling);
    // Agent 执行任务时关联已启用的外部 MCP 服务（如 DuckDuckGo 搜索），
    // 与普通智能体对话一样支持工具调用循环。
    const externalTools = await listExternalTools().catch(() => []);
    const text = await this.agentChat(opts.kbId, sys, opts.userMessage, {
      canWrite: true,
      sampling,
      externalTools
    });
    const result = { kind: 'text' as const, text };
    if (agent.postRun) await agent.postRun(ctx, result);
    return text;
  }

  /**
   * 流式版 runAgent（供 hubRunStream 使用）。
   */
  async *runAgentStream(opts: {
    agentId: string;
    kbId?: string;
    userMessage: string;
    extra?: Record<string, unknown>;
    input?: Record<string, unknown>;
    history?: unknown[];
    signal?: AbortSignal;
  }): AsyncGenerator<{ delta: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const agent = agentRegistry.get(opts.agentId);
    if (!agent) throw new Error(`未知 Agent: ${opts.agentId}`);
    const ctx: AgentRunCtx = {
      kbId: opts.kbId,
      input: opts.input ?? { text: opts.userMessage },
      history: opts.history,
      extra: opts.extra
    };
    if (agent.preRun) await agent.preRun(ctx);
    const sys = await composeAgentSystem(agent, ctx);
    const sampling = mergeSampling(agent.sampling);
    let full = '';
    const capture: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
    const externalTools = await listExternalTools().catch(() => []);
    // 若关联了外部 MCP 服务，使用支持工具调用的 agentChat 完成后再流式输出结果；
    // 否则保持原 streamChat 路径，避免无谓的性能开销。
    if (externalTools.length > 0) {
      full = await this.agentChat(opts.kbId, sys, opts.userMessage, {
        canWrite: true,
        sampling,
        externalTools
      });
      // 以 token/词粒度流式输出完整文本，保持前端流式体验
      const tokens = full.split(/(\s+)/).filter(Boolean);
      for (let i = 0; i < tokens.length; i++) {
        if (opts.signal?.aborted) break;
        yield { delta: tokens[i] };
      }
    } else {
      for await (const chunk of this.streamChat(opts.userMessage, sys, { signal: opts.signal, sampling })) {
        full += chunk.delta;
        if (chunk.usage) {
          capture.promptTokens = chunk.usage.promptTokens;
          capture.completionTokens = chunk.usage.completionTokens;
        }
        yield chunk;
      }
    }
    const result = { kind: 'text' as const, text: full };
    if (agent.postRun) await agent.postRun(ctx, result);
  }
}

function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function safeRead(root: string, rel: string) {
  return join(root, rel);
}

export const aiService = new AIService();
