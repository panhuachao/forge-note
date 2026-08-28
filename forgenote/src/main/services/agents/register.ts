// 注册全部内置 Agent（方案 §3.2 / §4.6.3）
import { agentRegistry } from './registry';
import { conversationalist } from './built-in/conversationalist';
import { diagnostician } from './built-in/diagnostician';
import { refiner } from './built-in/refiner';
import { cardSmith } from './built-in/card-smith';
import { inspirer } from './built-in/inspirer';
import { dailyMuse } from './built-in/daily-muse';
import type { AgentProfile } from './types';

const BUILT_IN: AgentProfile[] = [
  conversationalist,
  diagnostician,
  refiner,
  cardSmith,
  inspirer,
  dailyMuse
];

/** 进程启动时调用：注册内置 + 叠加用户覆写 */
export function registerBuiltInAgents(): void {
  agentRegistry.registerAll(BUILT_IN);
  agentRegistry.applyAllOverrides();
}
