// MCP 工具相关类型（主进程与渲染进程共用）
//
// 原本这些类型定义在 src/main/services/tool-runtime.ts。
// 插件系统需要让 shared 层引用 MCPTool（插件要注册工具），
// 而 shared 不能反向依赖 main（否则渲染进程打包会引入主进程代码），
// 因此上提到 shared，tool-runtime 改为引用并 re-export 保持兼容。

/** MCP 工具描述（OpenAI function calling 风格） */
export interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** 工具执行上下文 */
export interface ToolCtx {
  kbId: string;
}

/** 一次工具调用请求 */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** 工具调用轨迹（展示给用户的「工具调用气泡」） */
export interface ToolActivity {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

/** 工具处理函数 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolCtx
) => Promise<unknown> | unknown;
