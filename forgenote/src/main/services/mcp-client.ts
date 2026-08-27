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

/** 标准化的工具描述（与 KB_TOOLS 同形态） */
export interface MCPTool {
  name: string; // 形如 <server>.<action>
  description: string;
  input_schema: Record<string, unknown>;
}

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
      this.proc = spawn(this.cfg.command, this.cfg.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc.stdout.on('data', (d) => this.onData(d.toString()));
      this.proc.stderr.on('data', () => {/* 忽略外部进程日志噪声 */});
      this.proc.on('error', (e) => reject(e));
      // 初始化握手
      this.call({ method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'forgenote', version: '1.0' } } })
        .then(() => this.call({ method: 'notifications/initialized' }))
        .then(() => resolve())
        .catch(reject);
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

  async listTools(): Promise<MCPTool[]> {
    const res = await this.call({ method: 'tools/list', params: {} });
    const list = (res.result as any)?.tools ?? [];
    return list.map((t: any) => ({
      name: `${this.cfg.name}.${t.name}`,
      description: t.description ?? '',
      input_schema: t.inputSchema ?? { type: 'object', properties: {} }
    }));
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
  const servers = enabledServers();
  const out: MCPTool[] = [];
  for (const s of servers) {
    try {
      if (s.transport === 'stdio') {
        const conn = connections.get(s.name) ?? new StdioMCPConnection(s);
        connections.set(s.name, conn);
        out.push(...(await conn.listTools()));
      } else if (s.transport === 'sse' && s.url) {
        // SSE 端点：直接 HTTP 拉取工具清单（简化实现，连接复用交由上层）
        const r = await fetch(`${s.url.replace(/\/$/, '')}/tools`, { method: 'GET' }).catch(() => null);
        if (r?.ok) {
          const data = (await r.json()) as any;
          for (const t of data.tools ?? []) {
            out.push({ name: `${s.name}.${t.name}`, description: t.description ?? '', input_schema: t.inputSchema ?? { type: 'object', properties: {} } });
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

/** 执行外部 MCP 工具调用；失败时返回安全文本，绝不抛出中断主链路 */
export async function executeExternalTool(name: string, args: Record<string, unknown>): Promise<string> {
  const [server, action] = name.split('.');
  if (!server || !action) return `未知外部工具: ${name}`;
  const cfg = enabledServers().find((s) => s.name === server);
  if (!cfg) return `外部 MCP server 未启用: ${server}`;
  try {
    if (cfg.transport === 'stdio') {
      const conn = connections.get(server) ?? new StdioMCPConnection(cfg);
      connections.set(server, conn);
      return await conn.callTool(action, args);
    }
    if (cfg.transport === 'sse' && cfg.url) {
      const r = await fetch(`${cfg.url.replace(/\/$/, '')}/tools/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: args })
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
