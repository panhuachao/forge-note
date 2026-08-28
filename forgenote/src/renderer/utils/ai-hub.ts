// AIHub 统一调用封装（doc/AI智能管家重构方案.md §5.1 P0-2）
//
// 背景：此前渲染层同时存在两条 AI 调用通道——
//   旧通道 window.forge.ai.<业务方法>（suggestLinks / refineNote / insertLinks ...）
//   新通道 window.forge.ai.hubRun / hubRunStream（AIHub → Skill）
// 旧通道绕过 AIHub，导致「安全确认 / 用量埋点 / 画像抽取 / Agent 人格注入」
// 四套统一机制全部失效。
//
// 约定：新增 AI 调用一律走本文件的 hubRun / hubStructured / hubText，
// 不得再直接调用 window.forge.ai.<业务方法>。
import type { AIResponse, AITurn, ConfirmableAction } from '@shared/types/ai';

export interface HubRequest {
  skill: string;
  input: Record<string, unknown>;
  kbId?: string;
  sessionId?: string;
  agentId?: string;
  extra?: Record<string, unknown>;
  /** 确认上一轮草稿（Confirm-then-Act 第二轮） */
  confirm?: boolean;
  /** confirm=true 时携带的待执行 action */
  draft?: unknown;
  history?: AITurn[];
}

export type HubResult = AIResponse & { sessionId?: string };

/** 原始调用：返回统一 AIResponse，调用方自行按 kind 分支 */
export async function hubRun(req: HubRequest): Promise<HubResult> {
  return (await window.forge.ai.hubRun(req)) as HubResult;
}

/**
 * 取结构化结果：Skill 约定返回 { kind:'structured', data }。
 * pending=true 表示这是「待用户确认的建议」，此时应渲染确认卡片而非直接使用，
 * 故这里抛错提示调用方走 hubRun 自行处理。
 */
export async function hubStructured<T>(req: HubRequest): Promise<T> {
  const r = await hubRun(req);
  if (r.kind !== 'structured') {
    throw new Error(r.kind === 'text' ? r.text : `技能 ${req.skill} 未返回结构化结果`);
  }
  return r.data as T;
}

/** 取纯文本结果（structured / tool 会退化为 JSON 字符串） */
export async function hubText(req: HubRequest): Promise<string> {
  const r = await hubRun(req);
  if (r.kind === 'text' || r.kind === 'stream') return r.text;
  if (r.kind === 'structured') return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  return JSON.stringify(r.steps);
}

/**
 * 提交「待确认建议」的执行（Confirm-then-Act 第二轮）。
 * 携带同一 sessionId + confirm:true + draft，主进程直接执行 preview 过的操作，
 * 不会让模型重新生成内容，保证「所见即所改」。
 */
export async function hubConfirm(req: HubRequest, action: ConfirmableAction): Promise<HubResult> {
  return hubRun({ ...req, confirm: true, draft: action });
}

/**
 * 直接执行一个已注册的确认操作，**不经过 AIHub、不需要模型**。
 * 用于巡检这类由本地规则生成的建议（P2-1），执行后可继续走 hubVerify / hubRollback。
 */
export async function hubExecute(action: ConfirmableAction, kbId?: string): Promise<{ ok: boolean; message: string }> {
  return await window.forge.ai.executeAction(action, kbId);
}

/**
 * 执行后验证（doc/AI智能管家重构方案.md §6.3 P2-3）。
 * 回读笔记逐条校验修改是否真的生效；ok=false 时应提示用户可回滚。
 */
export async function hubVerify(
  action: ConfirmableAction,
  kbId?: string
): Promise<{ ok: boolean; message: string }> {
  return await window.forge.ai.verifyAction(action, kbId);
}

/** 回滚已执行的操作（恢复到修改前的内容） */
export async function hubRollback(
  action: ConfirmableAction,
  kbId?: string
): Promise<{ ok: boolean; message: string }> {
  return await window.forge.ai.rollbackAction(action, kbId);
}
