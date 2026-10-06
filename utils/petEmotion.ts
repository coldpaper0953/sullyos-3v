// 桌宠情绪引擎：四维（开心/生气/孤独/兴奋 0-100）随时间漂移，dominant 得出当前心情。
// 从嗡嗡嗡 Android 版 Emotion.java 移植为 web 版，localStorage 持久化。
//
// 设计要点（沿用原版的「简单直接」原则）：
// - 只对外说「当前心情」，不抛四维数字（四维仅内部漂移用）
// - 互动 add() 立即生效；drift() 按「距上次互动的分钟数」分档漂移

const STORAGE_KEY = 'petdesk-emotion';

export type MoodName = '开心' | '生气' | '孤独' | '兴奋' | '平静';

export interface EmotionState {
  happy: number;
  angry: number;
  lonely: number;
  excited: number;
  /** 上次互动时间戳（毫秒） */
  lastInteractAt: number;
}

const clamp = (v: number): number => Math.max(0, Math.min(100, v));

const DEFAULT: EmotionState = {
  happy: 50,
  angry: 10,
  lonely: 20,
  excited: 40,
  lastInteractAt: Date.now(),
};

export function loadEmotion(): EmotionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        happy: typeof p.happy === 'number' ? p.happy : DEFAULT.happy,
        angry: typeof p.angry === 'number' ? p.angry : DEFAULT.angry,
        lonely: typeof p.lonely === 'number' ? p.lonely : DEFAULT.lonely,
        excited: typeof p.excited === 'number' ? p.excited : DEFAULT.excited,
        lastInteractAt: typeof p.lastInteractAt === 'number' ? p.lastInteractAt : Date.now(),
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT };
}

export function saveEmotion(s: EmotionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

/** 互动：给某维度加 n，并刷新 lastInteractAt */
export function add(s: EmotionState, mood: MoodName, n: number): EmotionState {
  const next = { ...s, lastInteractAt: Date.now() };
  if (mood === '开心') next.happy = clamp(next.happy + n);
  else if (mood === '生气') next.angry = clamp(next.angry + n);
  else if (mood === '孤独') next.lonely = clamp(next.lonely + n);
  else if (mood === '兴奋') next.excited = clamp(next.excited + n);
  return next;
}

/** 距上次互动分钟数 → 漂移：10 分钟内保持正向、10-30 渐平静、30-60 孤独积累、>60 开心跌谷底 */
export function drift(s: EmotionState): EmotionState {
  const minutesSinceLast = (Date.now() - s.lastInteractAt) / 60000;
  const next = { ...s };
  if (minutesSinceLast <= 10) {
    next.happy = clamp(next.happy + 2);
    next.lonely = clamp(next.lonely - 2);
  } else if (minutesSinceLast <= 30) {
    next.happy = clamp(next.happy - 0.3);
    next.lonely = clamp(next.lonely + 0.2);
  } else if (minutesSinceLast <= 60) {
    next.happy = clamp(next.happy - 0.8);
    next.lonely = clamp(next.lonely + 0.6);
    next.angry = clamp(next.angry - 0.2);
  } else {
    next.happy = clamp(next.happy - 1.5);
    next.lonely = clamp(next.lonely + 1.2);
    next.excited = clamp(next.excited - 0.5);
  }
  return next;
}

/** 当前主导情绪（各维都低时视为平静） */
export function dominant(s: EmotionState): MoodName {
  const max = Math.max(s.happy, s.angry, s.lonely, s.excited);
  if (s.happy >= 15 && s.happy >= max) return '开心';
  if (s.angry >= 15 && s.angry >= max) return '生气';
  if (s.excited >= 15 && s.excited >= max) return '兴奋';
  if (s.lonely >= 15) return '孤独';
  return '平静';
}

/** 当前心情：开心/生气/孤独/兴奋 里最主导的那个，都很低就是「平静」 */
export function mood(s: EmotionState): MoodName {
  return dominant(s);
}

/** 心情文本（界面显示用） */
export function describe(s: EmotionState): string {
  return '当前心情：' + mood(s);
}
