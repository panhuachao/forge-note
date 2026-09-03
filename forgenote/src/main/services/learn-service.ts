// 主题学习服务（Learn）
// 1) 依据主题 + 模式，先让大模型产出「模块/栏目 + 文章大纲」计划；
// 2) 再逐篇生成文章正文（不同模式对应不同提示词与文体/严谨性约定）；
// 3) 全程落盘到目录/文件存储（{userData}/forgenote/learnings/<主题>/），
//    index.json 存概要+目录，<文章名>.md 存正文；生成中可恢复，完成后可查看。
import { nanoid } from 'nanoid';
import { aiService } from './ai-service';
import {
  resolveTopicDir,
  assignArticleFiles,
  writeSessionMeta,
  writeArticleFile,
  loadFullSession,
  loadSummary,
  findSessionDirById,
  deleteSessionDir,
  listTopicDirs,
  loadArticleByFile,
  invalidateDirCache,
  invalidateContentCache,
  setCachedArticleContent
} from './learn-storage';
import {
  LEARN_MODES,
  getLearnMode,
  type LearnMode,
  type LearnModule,
  type LearnArticle,
  type LearningSession,
  type LearnSessionSummary,
  type LearnProgress,
  type LearnCreateInput
} from '@shared/types/learn';

/**
 * 带退避重试的 AI 调用，专门扛网络层瞬时抖动：
 * fetch failed / UND_ERR_CONNECT_TIMEOUT / ECONNRESET / 超时 等。
 *
 * 非瞬时错误（鉴权失败、4xx、JSON 解析失败等）会立即抛出，不做无谓重试。
 * 重试上限由 attempts 控制（默认 3 次，间隔 1s → 2s → 4s）。
 */
async function chatWithRetry(
  prompt: string,
  sys: string,
  sampling?: { temperature?: number; top_p?: number; presence_penalty?: number; frequency_penalty?: number; max_tokens?: number },
  attempts = 3
): Promise<string> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await aiService.chat(prompt, sys, sampling);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e).toLowerCase();
      const name = String(e?.name ?? '').toLowerCase();
      const isTransient =
        msg.includes('fetch failed') ||
        msg.includes('und_err') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('timeout') ||
        msg.includes('aborted') ||
        msg.includes('network') ||
        msg.includes('econn') ||
        msg.includes('socket') ||
        name === 'timeouterror' || // AbortSignal.timeout
        name === 'aborterror';
      if (!isTransient || i === attempts) break;
      const wait = Math.min(1000 * Math.pow(2, i - 1), 8000); // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * 稳健地从模型返回文本中抽取 JSON 对象。
 *
 * 大模型返回的 JSON 经常有这些毛病：
 *  1. 被 ```json 代码块包裹
 *  2. 前后夹杂解释性文本
 *  3. 尾随逗号 `,}` `,]`
 *  4. 字符串内未转义的换行 / 中文引号
 *  5. 因 max_tokens 截断，导致数组或字符串被砍断
 *
 * 这里采用「逐步收紧」的策略：先尝试直接 parse，失败则逐项清理 / 截断，
 * 直到能解析或所有尝试都失败（抛出原始错误）。
 */
function extractJson(text: string): any {
  if (!text) throw new Error('模型返回为空');

  // 1) 去掉 markdown 代码块包裹
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  // 2) 截取首个 { 到最后一个 } 的区间（粗略剥离前后杂质）
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('模型未返回 JSON 对象');
  }
  let raw = t.slice(start, end + 1);

  // 3) 多种候选清洗：依次尝试 parse，第一个成功就返回
  const candidates: string[] = [];

  // 3a) 原样
  candidates.push(raw);
  // 3b) 去掉尾随逗号
  candidates.push(raw.replace(/,(\s*[}\]])/g, '$1'));
  // 3c) 去掉 BOM / 不可见字符
  candidates.push(raw.replace(/[\uFEFF\u200B\u200C\u200D\u200E\u200F\u2028\u2029\u2060]/g, ''));
  // 3d) 中文引号 → 转义（部分模型会输出 “ ” ‘ ’ 但忘记转义）
  candidates.push(
    raw
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/“/g, '\\"').replace(/”/g, '\\"')
      .replace(/‘/g, "\\'").replace(/’/g, "\\'")
  );

  let lastErr: unknown;
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (e) {
      lastErr = e;
    }
  }

  // 4) 截断修复：原串若因 token 截断不完整，从尾部逐字符删除直到能 parse
  const base = raw.replace(/,(\s*[}\]])/g, '$1'); // 先去掉尾随逗号
  for (let i = base.length - 1; i > 0; i--) {
    const ch = base[i];
    if (ch !== '}' && ch !== ']' && ch !== ',') continue;
    let trial = base.slice(0, i);
    // 截断点需要闭合所有未关闭的括号
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (let k = 0; k < trial.length; k++) {
      const c = trial[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') stack.pop();
    }
    // 闭合字符串
    if (inStr) trial += '"';
    // 补齐未闭合的括号
    trial = trial.replace(/,(\s*)$/, ''); // 去尾部孤立逗号
    for (let k = stack.length - 1; k >= 0; k--) trial += stack[k];
    try {
      return JSON.parse(trial);
    } catch {
      /* 继续往更短的串试 */
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('无法解析模型返回的 JSON');
}

function buildSystem(mode: LearnMode): string {
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  return [
    '你是「锦囊笔记 ForgeNote」的主题学习助手，负责把任意主题拆解为系统的学习路径并撰写系列文章。',
    `当前日期：${today}。`,
    `当前学习模式：${mode.title}。`,
    `模式要求（角色与能力）：${mode.system}`,
    `输出文体要求：${mode.style}`,
    '通用约束：内容必须准确、不编造；不输出与文章无关的解释；使用中文；Markdown 格式，含多级标题与要点列表。'
  ].join('\n');
}

async function generatePlan(topic: string, extra: string, mode: LearnMode): Promise<LearnModule[]> {
  const sys = buildSystem(mode) + '\n\n你同时是一位课程/知识体系架构师，擅长把主题拆成由浅入深的学习路径。';
  const prompt = [
    `主题：「${topic}」`,
    `补充要求：${extra?.trim() || '无'}`,
    '',
    '请为这个主题设计一套系统的学习路径，拆分成若干个「模块/栏目」，每个模块下包含若干篇「文章」。',
    '',
    '【输出铁律】',
    '1. 严格只输出一个 JSON 对象，不要任何解释、客套、Markdown 标题、代码块包裹；',
    '2. 字符串内部的双引号必须转义为 \\"，换行必须用 \\n；',
    '3. 数组或对象最后一个元素后不要加逗号；',
    '4. JSON 末尾必须完整闭合所有括号，不要半截截断；',
    '5. 中文标点 `,。;:!?` 可以直接放在字符串内；',
    '',
    '结构：',
    '{',
    '  "modules": [',
    '    { "title": "模块名", "articles": [ { "title": "文章标题", "outline": ["要点1", "要点2"] } ] }',
    '  ]',
    '}',
    '',
    '要求：',
    '- 3-5 个模块、每个模块 2-3 篇文章，覆盖从基础到进阶；文章标题要有层次、互不重复；',
    '- 每篇 outline 只写 1-3 个极简要点（每个 ≤ 12 字），不要写正文；'
  ].join('\n');

  const raw = await chatWithRetry(prompt, sys, { temperature: 0.4, max_tokens: 900 });
  let parsed: any;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    // 把原始片段带上，方便排查；同时抛出可读错误
    const head = (raw || '').slice(0, 240).replace(/\n/g, ' ');
    throw new Error(`模型未返回合法 JSON（已尝试修复）。原始内容前 240 字符：${head}…`);
  }
  const modulesRaw: any[] = Array.isArray(parsed?.modules) ? parsed.modules : [];
  return modulesRaw
    .filter((m) => m && typeof m.title === 'string')
    .map((m) => ({
      id: nanoid(8),
      title: m.title,
      articles: (Array.isArray(m.articles) ? m.articles : [])
        .filter((a: any) => a && typeof a.title === 'string')
        .map((a: any) => ({
          id: nanoid(8),
          title: a.title,
          outline: Array.isArray(a.outline) ? a.outline.map(String) : [],
          content: '',
          file: ''
        }))
    }));
}

/** 逐篇生成时使用的精简系统提示：保留模式角色与文体要求，去掉日期 / 通用约束等重复内容 */
function buildArticleSystem(mode: LearnMode): string {
  return [
    `你是「锦囊笔记」主题学习助手，当前学习模式：${mode.title}。`,
    `角色要求：${mode.system}`,
    `输出文体要求：${mode.style}`,
    '直接输出文章正文（中文 Markdown），不包裹代码块、不写标题以外的客套话。'
  ].join('\n');
}

async function generateArticle(
  topic: string,
  extra: string,
  mode: LearnMode,
  moduleTitle: string,
  art: LearnArticle
): Promise<string> {
  const sys = buildArticleSystem(mode);
  const outline = art.outline && art.outline.length
    ? art.outline.map((o, i) => `${i + 1}. ${o}`).join('\n')
    : '（请自行组织合理的结构）';
  const prompt = [
    `主题：「${topic}」`,
    `所属模块：「${moduleTitle}」`,
    `本篇文章标题：「${art.title}」`,
    '建议要点：',
    outline,
    `补充要求：${extra?.trim() || '无'}`,
    '',
    '请撰写这篇学习文章。要求：',
    '- 使用 Markdown，含多级标题、要点列表，必要时给出示例、类比或表格；',
    '- 严格遵守当前学习模式的文体与严谨性约定；',
    '- 篇幅适中、逻辑连贯、便于理解记忆；避免「综上所述」式空话，给出可操作或可沉淀的内容。'
  ].join('\n');

  return await chatWithRetry(prompt, sys, {
    temperature: mode.sampling.temperature,
    max_tokens: mode.sampling.max_tokens
  });
}

export const learnService = {
  /** 列出所有学习会话摘要（按创建时间倒序） */
  async list(): Promise<LearnSessionSummary[]> {
    return listTopicDirs()
      .map((dir) => loadSummary(dir))
      .filter((x): x is LearnSessionSummary => !!x)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  /** 获取会话结构（不含文章正文，正文按需通过 getArticle 获取） */
  async get(id: string): Promise<LearningSession | null> {
    const dir = findSessionDirById(id);
    if (!dir) return null;
    return loadFullSession(dir, false);
  },

  /** 按需获取单篇文章正文（只读对应 .md，不再读 index.json；进程内 LRU 命中即返回） */
  async getArticle(
    id: string,
    file: string
  ): Promise<{ content: string } | null> {
    const dir = findSessionDirById(id);
    if (!dir) return null;
    return loadArticleByFile(id, dir, file);
  },

  /** 删除会话（整个主题文件夹） */
  async delete(id: string): Promise<void> {
    const dir = findSessionDirById(id);
    if (dir) {
      deleteSessionDir(dir);
      invalidateDirCache(id);
      invalidateContentCache(id);
    }
  },

  /**
   * 创建主题学习会话：先生成计划，再逐篇生成正文。
   * onProgress 在关键节点回传进度（主进程据此推送到渲染层）。
   * 全程持续落盘（index.json + 每篇 .md），任一阶段中断都不会丢失已生成内容。
   */
  async create(
    input: LearnCreateInput,
    onProgress?: (p: LearnProgress) => void
  ): Promise<LearningSession> {
    const mode = getLearnMode(input.mode);
    const sessionId = nanoid(10);
    const session: LearningSession = {
      id: sessionId,
      topic: input.topic.trim(),
      extra: input.extra || '',
      mode: mode.key,
      modeTitle: mode.title,
      createdAt: Date.now(),
      modules: [],
      status: 'planning'
    };
    // 主题文件夹路径（同名主题自动用短 id 区分）
    const dir = resolveTopicDir(session.topic, sessionId);
    // 创建即落盘（planning 状态 + 空目录），便于中断恢复
    writeSessionMeta(dir, session);

    try {
      onProgress?.({
        phase: 'planning',
        sessionId,
        step: 1,
        message: '第一步：正在生成目录架构（模块与文章大纲）…'
      });

      const plan = await generatePlan(input.topic, input.extra, mode);
      if (plan.length === 0) throw new Error('模型未能规划出有效的学习模块，请调整主题后重试。');
      session.modules = plan;
      session.status = 'generating';
      // 为每篇文章分配 .md 文件名，并落盘 index.json（含目录、不含正文）
      assignArticleFiles(session.modules, dir);
      writeSessionMeta(dir, session);
      const totalArticles = plan.reduce((n, m) => n + m.articles.length, 0);
      onProgress?.({
        phase: 'plan-ready',
        sessionId,
        step: 1,
        modules: plan,
        totalArticles,
        message: `第一步完成：已规划 ${plan.length} 个模块 / ${totalArticles} 篇文章，开始第二步逐篇生成`
      });

      // 预计算每个模块之前的累计文章数，用于换算全局序号（第 X/Y 篇）
      const offsetBefore: number[] = [];
      let acc = 0;
      for (const m of session.modules) {
        offsetBefore.push(acc);
        acc += m.articles.length;
      }

      for (let mi = 0; mi < session.modules.length; mi++) {
        const mod = session.modules[mi];
        for (let ai = 0; ai < mod.articles.length; ai++) {
          const art = mod.articles[ai];
          const no = offsetBefore[mi] + ai + 1; // 全局第几篇（1-based）
          onProgress?.({
            phase: 'article-start',
            sessionId,
            step: 2,
            articleNo: no,
            totalArticles,
            moduleIndex: mi,
            articleIndex: ai,
            title: art.title,
            message: `第二步：生成第 ${no}/${totalArticles} 篇 —「${mod.title} / ${art.title}」`
          });
          const content = await generateArticle(input.topic, input.extra, mode, mod.title, art);
          art.content = content;
          // 每完成一篇即落盘 .md + 进程缓存，避免中断丢失全部，也避免用户立刻点开再读一次磁盘
          if (art.file) {
            writeArticleFile(dir, art.file, content);
            setCachedArticleContent(sessionId, art.file, content);
          }
          onProgress?.({
            phase: 'article-done',
            sessionId,
            step: 2,
            articleNo: no,
            totalArticles,
            moduleIndex: mi,
            articleIndex: ai,
            title: art.title,
            content,
            message: `✓ 第 ${no}/${totalArticles} 篇完成：${art.title}`
          });
          // 篇间小歇，避免触发模型服务侧的速率限制（强/专家模式更长）
          await new Promise((r) => setTimeout(r, mode.key === 'expert' ? 600 : 300));
        }
      }

      session.status = 'done';
      writeSessionMeta(dir, session);
      onProgress?.({ phase: 'done', sessionId, message: '主题学习已生成完成' });
      return session;
    } catch (e: any) {
      // 翻译底层网络错误为可读提示，方便用户判断是「配置问题」还是「网络抖动」
      const raw = String(e?.message ?? e);
      const isNetwork = /fetch failed|UND_ERR|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|network|socket/i.test(raw);
      const friendly = isNetwork
        ? '网络连接失败：请检查 AI 模型 baseUrl / 网络是否可达；若使用代理或本地模型（Ollama）请确认服务已启动。已生成的文章不会丢失。'
        : raw;
      session.status = 'error';
      session.error = friendly;
      // 即便失败也保留已生成的目录与文章
      writeSessionMeta(dir, session);
      onProgress?.({ phase: 'error', sessionId, message: '生成失败：' + friendly });
      throw new Error(friendly);
    }
  }
};

export { LEARN_MODES };