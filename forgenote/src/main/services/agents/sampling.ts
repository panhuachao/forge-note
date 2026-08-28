// 采样参数工具（方案 §3.1 / §4.6 原则）
import type { AgentSampling } from './types';

export const DEFAULT_SAMPLING: Required<AgentSampling> = {
  temperature: 0.3,
  top_p: 1,
  presence_penalty: 0,
  frequency_penalty: 0,
  max_tokens: 2048
};

/** 合并：缺省 < Agent < 调用方 */
export function mergeSampling(base?: AgentSampling, override?: AgentSampling): Required<AgentSampling> {
  return {
    temperature: override?.temperature ?? base?.temperature ?? DEFAULT_SAMPLING.temperature,
    top_p: override?.top_p ?? base?.top_p ?? DEFAULT_SAMPLING.top_p,
    presence_penalty: override?.presence_penalty ?? base?.presence_penalty ?? DEFAULT_SAMPLING.presence_penalty,
    frequency_penalty: override?.frequency_penalty ?? base?.frequency_penalty ?? DEFAULT_SAMPLING.frequency_penalty,
    max_tokens: override?.max_tokens ?? base?.max_tokens ?? DEFAULT_SAMPLING.max_tokens
  };
}

/**
 * 按 provider 校正（方案 §6 风险：不同基模对 sampling 灵敏度差异）。
 * - ollama 本地模型对 presence_penalty 支持不稳定，钳制到 [0, 1.2]
 * - openai/deepseek 兼容协议支持完整
 */
export function clampSampling(
  s: Required<AgentSampling>,
  provider: 'openai' | 'ollama' | 'local'
): Required<AgentSampling> {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (provider === 'ollama') {
    return {
      ...s,
      temperature: clamp(s.temperature, 0, 2),
      presence_penalty: clamp(s.presence_penalty, 0, 1.2),
      frequency_penalty: clamp(s.frequency_penalty, 0, 1.2)
    };
  }
  return {
    ...s,
    temperature: clamp(s.temperature, 0, 2),
    presence_penalty: clamp(s.presence_penalty, 0, 2),
    frequency_penalty: clamp(s.frequency_penalty, 0, 2)
  };
}
