// AI 服务 - LLM 客户端、提示词组装、归纳/链接/卡片引擎
import { promises as fs } from 'fs';
import { join } from 'path';
import { getKB, getConfig, setConfig, saveAIPreset, getAIPresets } from './store';
import type { AIModelConfig, DirSuggestion, LinkInfo, CardDraft, QuickNoteResult } from '@shared/types';
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
    // 只要求 provider 与 apiKey 有效；model/baseUrl 缺失时由调用方给默认值
    return cfg.provider !== 'none' && !!cfg.apiKey;
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
      const c: AIModelConfig = { ...cfg, baseUrl: cfg.baseUrl || 'http://127.0.0.1:11434', model: cfg.model || 'qwen2.5:7b' };
      return this.callOllama(c, sysPrompt, prompt);
    }
    if (cfg.provider === 'openai') {
      // 提供合理默认值，避免用户漏填 model/baseUrl 直接降级
      const c: AIModelConfig = {
        ...cfg,
        baseUrl: cfg.baseUrl || 'https://api.deepseek.com/v1',
        model: cfg.model || 'deepseek-chat'
      };
      return this.callOpenAI(c, sysPrompt, prompt);
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
    console.log('[ai.ask] kbId=', kbId, 'provider=', diag.provider, 'model=', diag.model, 'baseUrl=', diag.baseUrl);

    // 1) 关键词检索（局部精确命中）
    const hits = await searchService.query(kbId, question, { templateDirIds: opts?.templateDirIds, limit: 8 });
    const hitContext = hits
      .map((h) => `### [[${h.noteName}]]\n路径: ${h.notePath}\n片段: ${h.snippet}`)
      .join('\n\n');

    // 2) 知识库目录结构（全局视角）—— 始终附带，让 AI 能基于目录做归纳
    const dirTree = await this.buildDirOverview(kb.rootPath, kbId);

    // 3) 若用户问的是"某个目录下整体内容"，整目录读取作为上下文
    const fullDirContext = await this.maybeReadFullDir(kb.rootPath, kbId, question, hits);

    const sys = `${BASE_SYSTEM}\n\n${dirTree}\n\n${fullDirContext ? `# 目录整体内容（与问题强相关）\n${fullDirContext}\n\n` : ''}# 关键词检索片段（top ${hits.length}）\n${hitContext || '（未检索到与问题关键词精确匹配的片段）'}\n\n回答要求：\n- 若问题涉及"归纳/总结/进展/整体情况"，请基于【目录结构 + 目录整体内容】做归纳，引用具体笔记用 [[笔记名]]\n- 若问题涉及"如何使用某目录/目录是否合理"，请基于目录说明（README）和已有笔记分布给出建议\n- 引用时优先用 [[笔记名]] 形式标注`;
    return this.chat(question, sys);
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

    // 2) 候选链接（基于内容检索）
    const candidates = await searchService.query(kbId, text.slice(0, 200), { limit: 15 });

    // 3) 若调用方已指定归属目录，则跳过目录推断
    const dirSection =
      opts?.dirId && dirInfo.find((d) => d.id === opts.dirId)
        ? `用户已指定归属目录：${dirInfo.find((d) => d.id === opts.dirId)!.realDir}，无需重新推断，dirId 必须填 "${opts.dirId}"。`
        : `# 知识库目录（用于推断归属）\n${dirInfo
            .map((d) => `## ${d.realDir}\n${(d.readme || '').slice(0, 400)}`)
            .join('\n\n')}`;

    const sys = `${BASE_SYSTEM}\n\n你是一个知识整理助手。用户提交了一段原始内容，请一次性整理为结构化笔记草稿。\n\n# 基本原则\n1. 忠实于原文，不编造事实。\n2. 归属目录必须从给定目录中选最合适的一个。\n3. 标签 2-5 个，精炼、可复用。\n4. 双向链接从候选笔记中挑选最相关的 2-4 个，用笔记名（不含 .md）。\n\n# AI_CONFIG\n${aiConfig}\n\n${dirSection}\n\n# 候选相关笔记（用于双向链接）\n${candidates
      .slice(0, 10)
      .map((c) => `- ${c.noteName}（${c.notePath}）`)
      .join('\n')}\n\n# 输出格式（严格 JSON，不要多余文字）\n{\n  "title": "一句话标题",\n  "summary": "200 字内摘要，概括要点",\n  "dirId": "${dirInfo.map((d) => d.id).join('|') || '00'}",\n  "dirName": "归属目录真实名（如 01 项目）",\n  "tags": ["标签1", "标签2"],\n  "links": ["相关笔记名1", "相关笔记名2"]\n}`;

    const user = `# 用户原始内容\n${text.slice(0, 6000)}`;
    const raw = await this.chat(user, sys);
    return this.parseQuickNote(raw, dirInfo, opts?.dirId);
  }

  private parseQuickNote(
    raw: string,
    dirInfo: { id: string; name: string; realDir: string }[],
    forcedDirId?: string
  ): QuickNoteResult {
    const m = /```json\s*([\s\S]+?)\s*```/.exec(raw) || /(\{[\s\S]+\})/s.exec(raw);
    const fallback: QuickNoteResult = {
      title: '快速笔记',
      summary: '',
      dirId: forcedDirId || dirInfo[0]?.id || '00',
      dirName: dirInfo[0]?.realDir || '00 未分类',
      tags: [],
      links: []
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
        links: Array.isArray(obj.links) ? obj.links.map(String).slice(0, 6) : []
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
}

function safeRead(root: string, rel: string) {
  return join(root, rel);
}

export const aiService = new AIService();
