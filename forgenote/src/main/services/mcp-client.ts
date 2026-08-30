// 外部 MCP 适配层（方案 §6.4）
// 预留「外部 MCP Server（stdio / SSE）」接入能力：知识库 Skill 可声明 useTools: ['calendar.list', 'browser.fetch']，
// 实现跨域能力（把灵感写入日历、引用网页并归档）。外部 MCP 默认禁用，需在设置显式开启。
//
// 设计原则：
// - 不依赖任何外部 MCP SDK，用原生 child_process / fetch 走 JSON-RPC 协议，零新增依赖风险；
// - 所有外部调用经此处统一登记 + 错误兜底，失败时返回安全文本（绝不抛出中断主链路）；
// - 写类外部工具同样默认需用户确认（复用既有审计/确认语义）。
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { MCPServerConfig } from '@shared/types/ai';
import { aiService } from './ai-service';

/**
 * 自动检测系统代理（基于 Chromium/Electron 代理解析结果），
 * 返回可用于 stdio 子进程的环境变量。用户也可在 MCP 环境变量里手动覆盖。
 */
async function systemProxyEnv(): Promise<Record<string, string>> {
  try {
    const { session } = await import('electron');
    if (!session?.defaultSession?.resolveProxy) return {};
    const proxy = await session.defaultSession.resolveProxy('https://html.duckduckgo.com/');
    if (!proxy || proxy === 'DIRECT') return {};
    const env: Record<string, string> = {};
    for (const part of proxy.split(';')) {
      const [type, host] = part.trim().split(/\s+/);
      if (!host) continue;
      if (type === 'PROXY' || type === 'HTTPS') {
        const url = host.startsWith('http') ? host : `http://${host}`;
        env.HTTP_PROXY = url;
        env.HTTPS_PROXY = url;
      } else if (type === 'SOCKS' || type === 'SOCKS5') {
        env.ALL_PROXY = host.startsWith('socks') ? host : `socks5://${host}`;
      }
    }
    return env;
  } catch {
    return {};
  }
}

/** 标准化的工具描述（与 KB_TOOLS 同形态） */
export interface MCPTool {
  name: string; // OpenAI 合法名：仅 [a-zA-Z0-9_-]
  rawName?: string; // 原始 server.action
  description: string;
  input_schema: Record<string, unknown>;
}

/** 把工具名中的非法字符（如 '.'）替换为 '_'，使其符合 OpenAI function.name 格式要求 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[0-9_-]+/, 'x');
}

/** 为原始 server.action 生成唯一的 OpenAI 合法工具名，避免不同 server 冲突 */
function makeLegalToolName(server: string, action: string, used: Set<string>): string {
  const base = sanitizeToolName(`${server}_${action}`);
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}_${suffix}`;
    suffix++;
  }
  used.add(name);
  return name;
}

/** 合法工具名 -> 原始 server.action 的映射 */
const externalToolNameMap = new Map<string, string>();

interface JsonRpcReq {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcRes {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** 单个 stdio MCP server 的连接句柄（懒启动，复用进程） */
class StdioMCPConnection {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private seq = 1;
  private pending = new Map<number, (r: JsonRpcRes) => void>();

  constructor(private cfg: MCPServerConfig) {}

  private ensure(): Promise<void> {
    if (this.proc) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (!this.cfg.command) return reject(new Error('stdio MCP 缺少 command'));
      systemProxyEnv().then((proxyEnv) => {
        const command = this.cfg.command!;
        const proc = spawn(command, this.cfg.args ?? [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...proxyEnv, ...(this.cfg.env || {}) }
        });
        this.proc = proc;
        proc.stdout.on('data', (d) => this.onData(d.toString()));
        proc.stderr.on('data', () => {/* 忽略外部进程日志噪声 */});
        proc.on('error', (e) => reject(e));
        // 初始化握手
        this.call({ method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'forgenote', version: '1.0' } } })
          .then(() => this.call({ method: 'notifications/initialized' }))
          .then(() => resolve())
          .catch(reject);
      }).catch(reject);
    });
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcRes;
        const cb = this.pending.get(msg.id);
        if (cb) {
          this.pending.delete(msg.id);
          cb(msg);
        }
      } catch {
        /* 非 JSON 行忽略 */
      }
    }
  }

  private call(req: Omit<JsonRpcReq, 'jsonrpc' | 'id'>): Promise<JsonRpcRes> {
    return this.ensure().then(
      () =>
        new Promise<JsonRpcRes>((resolve, reject) => {
          const id = this.seq++;
          const full: JsonRpcReq = { jsonrpc: '2.0', id, ...req };
          this.pending.set(id, resolve);
          this.proc!.stdin.write(JSON.stringify(full) + '\n');
          setTimeout(() => {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              reject(new Error('MCP 调用超时'));
            }
          }, 20000);
        })
    );
  }

  async listTools(used = new Set<string>()): Promise<MCPTool[]> {
    const res = await this.call({ method: 'tools/list', params: {} });
    const list = (res.result as any)?.tools ?? [];
    return list.map((t: any) => {
      const rawName = `${this.cfg.name}.${t.name}`;
      const legalName = makeLegalToolName(this.cfg.name, t.name, used);
      externalToolNameMap.set(legalName, rawName);
      return {
        name: legalName,
        rawName,
        description: t.description ?? '',
        input_schema: t.inputSchema ?? { type: 'object', properties: {} }
      };
    });
  }

  async callTool(action: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.call({ method: 'tools/call', params: { name: action, arguments: args } });
    if (res.error) return `MCP 工具错误: ${res.error.message}`;
    const content = (res.result as any)?.content;
    if (Array.isArray(content)) return content.map((c: any) => c.text ?? '').join('\n');
    return String(res.result ?? '');
  }
}

const connections = new Map<string, StdioMCPConnection>();

/** 读取当前启用的外部 MCP server 配置 */
function enabledServers(): MCPServerConfig[] {
  const cfg = aiService.getConfigSync();
  return (cfg.mcpServers ?? []).filter((s) => s.enabled);
}

/** 列出所有已启用外部 MCP server 暴露的工具（合并为统一工具表，供 Skill.useTools 引用） */
export async function listExternalTools(): Promise<MCPTool[]> {
  externalToolNameMap.clear();
  const servers = enabledServers();
  const out: MCPTool[] = [];
  const used = new Set<string>();
  for (const s of servers) {
    try {
      if (s.transport === 'stdio') {
        const conn = connections.get(s.name) ?? new StdioMCPConnection(s);
        connections.set(s.name, conn);
        out.push(...(await conn.listTools(used)));
      } else if (s.transport === 'sse' && s.url) {
        // SSE 端点：直接 HTTP 拉取工具清单（简化实现，连接复用交由上层）
        const r = await fetch(`${s.url.replace(/\/$/, '')}/tools`, { method: 'GET' }).catch(() => null);
        if (r?.ok) {
          const data = (await r.json()) as any;
          for (const t of data.tools ?? []) {
            const rawName = `${s.name}.${t.name}`;
            const legalName = makeLegalToolName(s.name, t.name, used);
            externalToolNameMap.set(legalName, rawName);
            out.push({ name: legalName, rawName, description: t.description ?? '', input_schema: t.inputSchema ?? { type: 'object', properties: {} } });
          }
        }
      }
    } catch (e) {
      // 单个 server 不可用不影响其余能力
      console.warn(`[mcp] 外部 server ${s.name} 加载失败:`, String(e));
    }
  }
  return out;
}

/** 判断某个工具名是否为已加载的外部 MCP 工具 */
export function isExternalTool(name: string): boolean {
  return externalToolNameMap.has(name);
}

/**
 * 规范化 DuckDuckGo 等搜索工具的参数：
 * - 把常见别名（q/keywords/text/search）映射为 query
 * - 若 query 为空，返回明确错误提示，让模型重试
 */
function normalizeSearchArgs(action: string, args: Record<string, unknown>): Record<string, unknown> | string {
  if (!action.toLowerCase().includes('search')) return args;
  const next = { ...args };
  if (!next.query || typeof next.query !== 'string' || !next.query.trim()) {
    const alt = next.q ?? next.keywords ?? next.text ?? next.search;
    if (typeof alt === 'string' && alt.trim()) {
      next.query = alt.trim();
    } else {
      return '搜索查询不能为空（query 为空）。请提供具体的关键词，例如 "AI 新闻"、"科技热点"。';
    }
  } else {
    next.query = (next.query as string).trim();
  }
  return next;
}

/** 执行外部 MCP 工具调用；失败时返回安全文本，绝不抛出中断主链路 */
export async function executeExternalTool(name: string, args: Record<string, unknown>): Promise<string> {
  const rawName = externalToolNameMap.get(name) ?? name;
  const [server, action] = rawName.split('.');
  if (!server || !action) return `未知外部工具: ${name}`;
  const cfg = enabledServers().find((s) => s.name === server);
  if (!cfg) return `外部 MCP server 未启用: ${server}`;

  // 搜索类工具参数兼容与校验
  const normalized = normalizeSearchArgs(action, args);
  if (typeof normalized === 'string') return normalized;

  try {
    if (cfg.transport === 'stdio') {
      const conn = connections.get(server) ?? new StdioMCPConnection(cfg);
      connections.set(server, conn);
      const res = await conn.callTool(action, normalized);
      // 搜索类工具若因网络/区域被 DuckDuckGo 拦截（VQD 获取失败），给出可重试提示
      if (typeof res === 'string' && /Failed to get the VQD/i.test(res) && action.toLowerCase().includes('search')) {
        return `DuckDuckGo 检索失败：当前网络环境无法连接 DuckDuckGo（VQD 获取被拒）。可稍后重试，或检查网络/代理；也可改用其他搜索 MCP 服务。`;
      }
      return res;
    }
    if (cfg.transport === 'sse' && cfg.url) {
      const r = await fetch(`${cfg.url.replace(/\/$/, '')}/tools/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: normalized })
      });
      if (!r.ok) return `外部工具调用失败: ${r.status}`;
      const data = (await r.json()) as any;
      return Array.isArray(data.content) ? data.content.map((c: any) => c.text ?? '').join('\n') : String(data.result ?? '');
    }
  } catch (e) {
    return `外部工具执行失败: ${String(e)}`;
  }
  return `不支持的传输方式: ${cfg.transport}`;
}
