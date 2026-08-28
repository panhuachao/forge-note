// Agent 注册表（方案 §3.2 / §4.6.3）
import type { AgentProfile, AgentOverrides } from './types';
import { getConfig, setConfig } from '../store';

const OVERRIDE_KEY = 'ai:agents';

class AgentRegistry {
  private agents = new Map<string, AgentProfile>();

  register(a: AgentProfile): void {
    this.agents.set(a.id, a);
  }

  /** 启动时注册全部内置 Agent */
  registerAll(list: AgentProfile[]): void {
    list.forEach((a) => this.agents.set(a.id, a));
  }

  get(id: string): AgentProfile | undefined {
    return this.agents.get(id);
  }

  list(): AgentProfile[] {
    return [...this.agents.values()];
  }

  /** 读取用户覆写（app_config['ai:agents']） */
  loadOverrides(): AgentOverrides {
    return getConfig<AgentOverrides>(OVERRIDE_KEY, {}) ?? {};
  }

  /** 把用户覆写合并进内存实例（启动叠加 + 设置页热更新） */
  applyOverride(id: string, patch: AgentOverrides[string]): void {
    const base = this.agents.get(id);
    if (!base) return;
    const merged: AgentProfile = { ...base };
    if (patch.systemPrompt !== undefined) merged.systemPrompt = patch.systemPrompt;
    if (patch.sampling) merged.sampling = { ...base.sampling, ...patch.sampling };
    if (patch.retrieval) merged.retrieval = { ...base.retrieval, ...patch.retrieval } as AgentProfile['retrieval'];
    if (patch.profileFields) merged.profileFields = patch.profileFields;
    if (patch.extraSystem !== undefined) {
      const staticText = patch.extraSystem;
      merged.extraSystem = () => staticText;
    }
    this.agents.set(id, merged);
  }

  /** 应用全部用户覆写（启动时使用） */
  applyAllOverrides(): void {
    const ov = this.loadOverrides();
    Object.keys(ov).forEach((id) => this.applyOverride(id, ov[id]));
  }

  /** 持久化用户覆写（设置页调用） */
  saveOverrides(ov: AgentOverrides): void {
    setConfig(OVERRIDE_KEY, ov);
    this.applyAllOverrides();
  }
}

export const agentRegistry = new AgentRegistry();
