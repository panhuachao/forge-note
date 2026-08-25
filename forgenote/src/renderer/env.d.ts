// 渲染层全局类型声明 - 来自 preload 暴露的 window.forge
import type { ForgeAPI } from '../preload';

declare global {
  interface Window {
    forge: ForgeAPI;
  }
}

export {};
