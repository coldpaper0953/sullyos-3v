// 桌宠全局状态层：好感度 / 献血(喂食) / 饱食度 / 模式 / 主动搭话 / 人设 / 聊天历史 / 喝水 / 专注 / 形象。
// 从嗡嗡嗡 Android 版 DataStore + PetService 移植为 web 版，localStorage 持久化 + 事件订阅。
// FloatingPet（常驻悬浮）订阅事件；PetDeskApp（面板）按需读写。

const NS = 'petdesk:';

// ---------- 基础 KV ----------
function read<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? def : (JSON.parse(raw) as T);
  } catch { return def; }
}
function write(key: string, val: unknown): void {
  try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch { /* ignore */ }
}
function str(key: string, def = ''): string {
  try { return localStorage.getItem(NS + key) ?? def; } catch { return def; }
}
function setStr(key: string, v: string): void {
  try { localStorage.setItem(NS + key, v); } catch { /* ignore */ }
}
function num(key: string, def = 0): number {
  const n = Number(str(key, String(def)));
  return Number.isFinite(n) ? n : def;
}
function bool(key: string, def = false): boolean { return str(key, def ? '1' : '0') === '1'; }
function setBool(key: string, v: boolean): void { setStr(key, v ? '1' : '0'); }
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
export { todayStr };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------- 事件总线 ----------
type BubbleListener = (text: string, ms: number, prio: number) => void;
const bubbleListeners = new Set<BubbleListener>();
/** 全局气泡：FloatingPet 订阅后显示在宠物头顶 */
export function showBubble(text: string, ms = 3000, prio = 1): void {
  bubbleListeners.forEach(cb => cb(text, ms, prio));
}
export function onBubble(cb: BubbleListener): () => void {
  bubbleListeners.add(cb);
  return () => { bubbleListeners.delete(cb); };
}

type StateListener = () => void;
const stateListeners = new Set<StateListener>();
function emitState(): void { stateListeners.forEach(cb => cb()); }
/** 好感/模式/形象等状态变化后通知刷新（FloatingPet / PetDeskApp 订阅） */
export function onStateChange(cb: StateListener): () => void {
  stateListeners.add(cb);
  return () => { stateListeners.delete(cb); };
}

// ---------- 好感度 ----------
export const TITLE_LINES = [500, 1500, 3000];
export const TITLES = ['泛泛之交', '渐生情愫', '亲密无间', '灵魂契约'];

export function titleFor(aff: number): string {
  let idx = 0;
  for (let i = 0; i < TITLE_LINES.length; i++) if (aff >= TITLE_LINES[i]) idx = i + 1;
  return TITLES[idx];
}
export function getAff(): number { return num('aff'); }
export function setAffRaw(v: number): void { write('aff', Math.max(0, Math.round(v))); emitState(); }

/** 每日 50 点好感上限；返回 { applied, capped } */
export function awardAff(n: number): { applied: number; capped: boolean } {
  if (n <= 0) {
    setAffRaw(getAff() + n);
    return { applied: n, capped: false };
  }
  const t = todayStr();
  let day = num('dailyAff');
  if (t !== str('dailyDate')) day = 0;
  const applied = Math.min(n, Math.max(0, 50 - day));
  setAffRaw(getAff() + applied);
  write('dailyAff', day + applied);
  setStr('dailyDate', t);
  write('affMax', Math.max(num('affMax'), getAff()));
  emitState();
  return { applied, capped: applied < n };
}

/** 刚跨过的好感里程碑档（500/1500/3000），没有则 0 */
export function milestoneCrossed(prev: number, cur: number): number {
  for (const line of TITLE_LINES) if (prev < line && cur >= line) return line;
  return 0;
}

// ---------- 献血(喂食) / 饱食度 ----------
export function getSatiety(): number { return num('satiety', 70); }
export function setSatiety(v: number): void { write('satiety', clamp(v, 0, 100)); emitState(); }
export function getBloodTotal(): number { return num('bloodTotal'); }
export function addBloodTotal(v: number): void { write('bloodTotal', getBloodTotal() + v); emitState(); }

/** 累计献血五档称号 */
export function bloodTitle(): string {
  const t = getBloodTotal();
  if (t >= 3000) return '血祭之王 👑';
  if (t >= 1500) return '献血达人 🏅';
  if (t >= 600) return '贫血战士 ⚔️';
  if (t >= 250) return '轻度供血者 💉';
  return '血源新手 🩸';
}

const SAT_PER_SEC_DAY = 0.0035;
const SAT_NIGHT_MUL = 1.6;
const MAX_ELAPSED_SEC = 72 * 3600;

/** 按真实流逝秒数结算饱食度下降（幂等）。夜里 22-7 点 ×1.6。 */
export function tickOverTime(): void {
  const now = Date.now();
  const last = num('satAt');
  if (last <= 0) { write('satAt', now); return; }
  let sec = (now - last) / 1000;
  if (sec < 1) return;
  if (sec > MAX_ELAPSED_SEC) sec = MAX_ELAPSED_SEC;
  write('satAt', now);
  const h = new Date().getHours();
  const night = h >= 22 || h < 7;
  setSatiety(getSatiety() - sec * SAT_PER_SEC_DAY * (night ? SAT_NIGHT_MUL : 1));
}

export function hungerLevel(sat: number): 'starving' | 'hungry' | 'normal' | 'full' {
  if (sat < 15) return 'starving';
  if (sat < 35) return 'hungry';
  if (sat > 85) return 'full';
  return 'normal';
}

export type FeedResult =
  | { refused: true }
  | { refused: false; bite: number; gain: number; crit: boolean; satiety: number; newBloodTitle: string | null };

const FEED_REFUSE_PCT = 20;

/** 献血入口：20% 拒绝；否则吸 15~40 血、18% 暴击双倍、1:1 涨饱食度。 */
export function startFeed(): FeedResult {
  tickOverTime();
  if (Math.random() * 100 < FEED_REFUSE_PCT) {
    return { refused: true };
  }
  const crit = Math.random() * 100 < 18;
  const bite = 15 + Math.random() * 25;
  const before = getBloodTotal();
  addBloodTotal(bite);
  const gain = bite * (crit ? 2 : 1);
  const satBefore = getSatiety();
  setSatiety(satBefore + gain);

  // 跨献血称号档
  const lines = [250, 600, 1500, 3000];
  let newBloodTitle: string | null = null;
  for (const l of lines) {
    if (before + bite >= l && before < l) newBloodTitle = bloodTitle();
  }
  return { refused: false, bite: Math.round(bite), gain: Math.round(gain), crit, satiety: getSatiety(), newBloodTitle };
}

// ---------- 模式（专注/勿扰/工作/跳跃） ----------
export type PetMode = 'focus' | 'dnd' | 'work' | 'jump';
export function isMode(m: PetMode): boolean {
  if (m === 'focus') return focusActive();
  return bool('mode_' + m);
}
export function toggleMode(m: PetMode): void {
  if (m === 'focus') { toggleFocusQuick(); return; }
  const on = !bool('mode_' + m);
  setBool('mode_' + m, on);
  // jump 与 dnd/work 互斥（对齐原版：jump 开时关掉 dnd/work）
  if (m === 'jump' && on) {
    setBool('mode_dnd', false);
    setBool('mode_work', false);
  }
  if ((m === 'dnd' || m === 'work') && on) setBool('mode_jump', false);
  emitState();
}

// ---------- 专注（25 分钟番茄钟，快捷开关） ----------
interface FocusState { active: boolean; targetMin: number; startAt: number; }
function focusState(): FocusState { return read<FocusState>('focus', { active: false, targetMin: 25, startAt: 0 }); }
export function focusActive(): boolean { return focusState().active; }
export function focusText(): string {
  const f = focusState();
  if (!f.active) return '未开始';
  const remain = Math.max(0, f.targetMin * 60 - Math.floor((Date.now() - f.startAt) / 1000));
  return `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
}
/** 专注到点结算：返回 true 表示这一 tick 刚好结束了一场 */
export function focusTick(): boolean {
  const f = focusState();
  if (!f.active) return false;
  if (Date.now() - f.startAt >= f.targetMin * 60 * 1000) return true;
  return false;
}
export function finishFocus(): { msg: string; finished: boolean } {
  const f = focusState();
  if (f.active) {
    write('focus', { ...f, active: false });
    write('focusTotalN', num('focusTotalN') + 1);
    emitState();
    return { msg: `专注 ${f.targetMin} 分钟完成，好样的！`, finished: true };
  }
  return { msg: '当前没有进行中的专注', finished: false };
}
export function startFocus(targetMin = 25): void {
  write('focus', { active: true, targetMin, startAt: Date.now() });
  emitState();
}
function toggleFocusQuick(): void {
  if (focusActive()) {
    const { msg } = finishFocus();
    awardAff(10);
    showBubble(msg + ' +10 好感', 5000, 3);
  } else {
    startFocus(25);
    showBubble('专注 25 分钟开始，我盯着你哦～', 4000, 3);
  }
}

// ---------- 主动搭话配置 ----------
export function chatGapMin(): number { return num('chatGapMin', 10); }
export function setChatGapMin(v: number): void { write('chatGapMin', clamp(v, 0.5, 120)); }
export function chatJitter(): number { return num('chatJitter', 50); }
export function setChatJitter(v: number): void { write('chatJitter', clamp(v, 0, 100)); }
export function chatDailyCap(): number { return num('chatDailyCap', 0); }
export function setChatDailyCap(v: number): void { write('chatDailyCap', Math.max(0, Math.round(v))); }
export function appSense(): boolean { return bool('appSense', true); }
export function setAppSense(v: boolean): void { setBool('appSense', v); }

// ---------- 人设 ----------
export const PERSONA_MAX = 1500;
export function getPersona(): string { return str('petPersona'); }
export function setPersona(s: string): void { setStr('petPersona', s.slice(0, PERSONA_MAX)); }

// ---------- 聊天历史（最近 40 轮） ----------
export function getChatLog(): string[] { return read<string[]>('chatLog', []); }
export function logChat(who: string, text: string): void {
  const l = getChatLog();
  l.push(who + '：' + text);
  while (l.length > 40) l.shift();
  write('chatLog', l);
}
export function talkCount(): number { return num('talkCount'); }
export function bumpTalkCount(): number { const n = num('talkCount') + 1; write('talkCount', n); return n; }

// ---------- 喝水（水润少年成就） ----------
export function waterToday(): number {
  const o = read<{ day: string; cups: number }>('water', { day: todayStr(), cups: 0 });
  return o.day === todayStr() ? o.cups : 0;
}
export function drinkWater(): number {
  const cups = waterToday() + 1;
  write('water', { day: todayStr(), cups });
  emitState();
  return cups;
}

// ---------- 成就标记 ----------
export function getBool(key: string, def = false): boolean { return bool(key, def); }
export function putBool(key: string, v: boolean): void { setBool(key, v); emitState(); }
export function getInt(key: string, def = 0): number { return num(key, def); }
export function putInt(key: string, v: number): void { write(key, v); emitState(); }

// ---------- 自定义形象（6 动作换图，空 = 用内置帧） ----------
export type PetAction = 'mosquito' | 'happy' | 'sad' | 'work' | 'jump' | 'dead';
export const PET_ACTIONS: PetAction[] = ['mosquito', 'happy', 'sad', 'work', 'jump', 'dead'];
export function getSkin(a: PetAction): string { return str('skin_' + a); }
export function setSkin(a: PetAction, url: string): void { setStr('skin_' + a, url.trim()); emitState(); }
export function resetSkin(a: PetAction): void { setStr('skin_' + a, ''); emitState(); }
export function resetAllSkin(): void {
  for (const a of PET_ACTIONS) setStr('skin_' + a, '');
  emitState();
}

// ---------- 整蛊蚊群战绩 ----------
export function prankScore(): { bestWave: number; totalKills: number } {
  return read('prankScore', { bestWave: 0, totalKills: 0 });
}
export function savePrankScore(bestWave: number, totalKills: number): void {
  const p = prankScore();
  write('prankScore', { bestWave: Math.max(p.bestWave, bestWave), totalKills: p.totalKills + totalKills });
  emitState();
}

// ---------- 整蛊启动事件（PetDeskApp 触发，FloatingPet 渲染） ----------
type PrankListener = (count: number) => void;
const prankListeners = new Set<PrankListener>();
export function startPrank(count = 6): void { prankListeners.forEach(cb => cb(count)); }
export function onPrank(cb: PrankListener): () => void {
  prankListeners.add(cb);
  return () => { prankListeners.delete(cb); };
}
