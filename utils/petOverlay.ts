// 系统悬浮桌宠桥（原生 OverlayPetService 经 PetOverlayPlugin 暴露）。
// Web 端走 fallback（能力返回 false），保证浏览器 dev 不崩。
import { registerPlugin } from '@capacitor/core';

export interface PetOverlayPlugin {
  canOverlay(): Promise<{ granted: boolean }>;
  openOverlaySettings(): Promise<void>;
  /** size/speed/jumpPct/glideLevel 取桌面面板里的同一套外观参数，原生侧会做密度换算 */
  start(opts: { size?: number; speed?: number; jumpPct?: number; glideLevel?: number }): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<{ running: boolean }>;
}

const webFallback: PetOverlayPlugin = {
  canOverlay: async () => ({ granted: false }),
  openOverlaySettings: async () => { throw new Error('仅 Android 支持'); },
  start: async () => { throw new Error('仅 Android 支持'); },
  stop: async () => { throw new Error('仅 Android 支持'); },
  isRunning: async () => ({ running: false }),
};

export const PetOverlay = registerPlugin<PetOverlayPlugin>('PetOverlay', { web: webFallback });
