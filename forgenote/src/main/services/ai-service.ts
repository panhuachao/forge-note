// AI 服务 - LLM 客户端、提示词组装、归纳/链接/卡片引擎
import { promises as fs } from 'fs';
import { join } from 'path';
import { getKB, getConfig, setConfig, saveAIPreset, getAIPresets } from './store';
import type { AIModelConfig, DirSuggestion, LinkInfo, CardDraft } from '@shared/types';
import { extractWikiLinks, previewLine } from '../utils/markdown';
import { linkIndex } from './link-index';
import { searchService } from './search-service';

const BASE_SYSTEM = `你是「锦囊笔记 ForgeNote」内置的本地 AI 知识管家，遵循以下铁律：
1. 所有回答必须基于用户提供的笔记内容与知识库上下文，不编造信息。
2. 不得自动修改、删除、移动任何文件；所有结构性变更（移动笔记、插入链接、锻造卡片）必须由用户显式确认。
3. 引用笔记时请使用 [[笔记名]] 语法。
4. 当本地资料不足时，明确告知用户「本地未找到相关内容」，不要凭通用知识补全。`;

class AIService {
  private configCache: AIModelConfig | null = null;

  async getConfig(): Promise<AIModelConfig> {
    if (this.configCache) return this.configCache;
    const c = getConfig<AIModelConfig>('ai:config', {
      provider: 'none'
    });
    this.configCache = c || { provider: 'none' };
    return this.configCache;
  }

  async setConfig(cfg: Partial<AIModelConfig>): Promise<void> {
    const cur = await this.getConfig();
    const next = { ...cur, ...cfg };
    setConfig('ai:config', next);
    this.configCache = next;
  }

  private isEnabled(cfg: AIModelConfig): boolean {
    return cfg.provider !== 'none' && !!cfg.model;
  }

  /**
   * 通用聊天（流式）。本项目为简化实现，主进程一次性返回；渲染层用 chunked 渲染。
   */
  async chat(prompt: string, sysPrompt: string): Promise<string> {
    const cfg = await this.getConfig();
    if (!this.isEnabled(cfg)) {
      // 降级：本地规则引擎
      return this.localFallback(prompt, sysPrompt);
    }
    if (cfg.provider === 'ollama') {
      return this.callOllama(cfg, sysPrompt, prompt);
    }
    if (cfg.provider === 'openai') {
      return this.callOpenAI(cfg, sysPrompt, prompt);
    }
    return this.localFallback(prompt, sysPrompt);
  }

  private async callOllama(cfg: AIModelConfig, sys: string, user: string): Promise<string> {
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
        ]
      })
    });
    if (!r.ok) throw new Error(`Ollama 调用失败: ${r.status} ${await r.text()}`);
    const data = (await r.json()) as { message: { content: string } };
    return data.message.content || '';
  }

  private async callOpenAI(cfg: AIModelConfig, sys: string, user: string): Promise<string> {
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
        temperature: 0.3
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
      const content = await fs.readFile(join(kb.rootPath, 'AI_CONFIG.md'), 'utf-8');
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
    const hits = await searchService.query(kbId, question, { templateDirIds: opts?.templateDirIds, limit: 8 });
    const context = hits
      .map((h) => `### [[${h.noteName}]]\n路径: ${h.notePath}\n片段: ${h.snippet}`)
      .join('\n\n');
    const sys = `${BASE_SYSTEM}\n\n你将基于以下从用户知识库中检索到的片段回答问题，回答末尾请用 [[笔记名]] 形式列出引用：\n${context || '（未检索到相关笔记）'}`;
    return this.chat(question, sys);
  }

  /**
   * 摘要
   */
  async summarize(kbId: string, notePath: string): Promise<string> {
    const kb = getKB(kbId);
    if (!kb) return '';
    const content = await fs.readFile(safeRead(kb.rootPath, notePath), 'utf-8').catch(() => '');
    const sys = `${BASE_SYSTEM}\n\n请对以下笔记生成结构化摘要：要点列表 + 关键词 + 一句话总结。`;
    return this.chat(content.slice(0, 4000), sys);
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
          .readFile(join(kb.rootPath, realDir, 'README.md'), 'utf-8')
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
}

function safeRead(root: string, rel: string) {
  return join(root, rel);
}

export const aiService = new AIService();
