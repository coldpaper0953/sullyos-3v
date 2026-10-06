// 桌宠娱乐功能：运势 / 小剧场 / 迷你游戏 / 随机事件 / 成就 / 饲养指南。
// 从嗡嗡嗡 Android 版 Extras.java 移植。

import {
  getAff, awardAff, milestoneCrossed, getBloodTotal, getInt, putInt, getBool, putBool,
  waterToday, talkCount, titleFor,
} from './petStore';
import { quotesPick, quotesGet } from './petQuotes';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 冷却检查：距上次 >= ms 才放行并刷新时间戳 */
function cooldown(key: string, ms: number): boolean {
  const now = Date.now();
  if (now - getInt(key) < ms) return false;
  putInt(key, now);
  return true;
}

// ================= 随机事件（带冷却） =================
export function randomEvent(): string | null {
  if (Math.random() * 100 < 5 && cooldown('evAsk', 30 * 60 * 1000)) {
    return '💬 ' + quotesPick('ev_ask');
  }
  if (Math.random() * 100 < 1 && cooldown('evStory', 2 * 3600 * 1000)) {
    return '📖 ' + quotesPick('ev_story');
  }
  if (Math.random() * 100 < 3 && cooldown('evMood', 40 * 60 * 1000)) {
    return quotesPick('ev_mood');
  }
  return null;
}

// ================= 迷你游戏（带冷却 1 小时） =================
export interface MiniGame { title: string; prompt: string; }
export function miniGame(): MiniGame | null {
  if (Math.random() * 100 >= 2) return null;
  if (!cooldown('evGame', 3600 * 1000)) return null;
  const k = Math.floor(Math.random() * 3);
  if (k === 0) {
    const target = 1 + Math.floor(Math.random() * 100);
    putInt('gameAnswer', target);
    return { title: '🎯 猜数字', prompt: `我心里想了个 1-100 的数，跟我说答案！（${target}）` };
  }
  if (k === 1) {
    putInt('gameAnswer', 0);
    return { title: '🧩 谜语', prompt: '什么东西越洗越脏？（答案：水）' };
  }
  const a = 10 + Math.floor(Math.random() * 80), b = 10 + Math.floor(Math.random() * 80);
  putInt('gameAnswer', a * b);
  return { title: '🧮 心算挑战', prompt: `${a} × ${b} 等于几？（${a * b}）` };
}

// ================= 今日运势（日期种子，同一天固定） =================
export function fortune(): string {
  const day = todayStr();
  let seed = 0;
  for (const c of day) seed = seed * 31 + c.charCodeAt(0);
  const rnd = (() => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; });
  const stars = 1 + Math.floor(rnd() * 5);
  const luck = ['大凶', '小凶', '平', '小吉', '大吉'];
  const tips = ['宜摸蚊子头，好运 +1', '宜喝水八杯，水逆退散', '忌久坐，起来蹦跶两下', '宜夸我今天可爱', '宜专注一小时，财运亨通', '忌熬夜，蚊子都要睡了'];
  return `🔮 今日运势：${luck[stars - 1]} ${'⭐'.repeat(stars)}\n${tips[Math.floor(rnd() * tips.length)]}`;
}

// ================= 小剧场（2%，1 小时冷却） =================
export interface TheaterScene { scene: string; a: string; b: string; }
export function theater(): TheaterScene | null {
  if (Math.random() * 100 >= 2) return null;
  if (!cooldown('evTheater', 3600 * 1000)) return null;
  const ths = quotesGet('theater');
  if (!ths.length) return null;
  const t = ths[Math.floor(Math.random() * ths.length)].split('|');
  return t.length === 3 ? { scene: t[0], a: t[1], b: t[2] } : null;
}

/** 小剧场结算：A 倾向 +5~15，B 随机 -10~+10；记入回忆录（最近 100 条） */
export function theaterResult(choiceIdx: number, scene: string, choice: string): string {
  const delta = choiceIdx === 0 ? 5 + Math.floor(Math.random() * 11) : -10 + Math.floor(Math.random() * 21);
  const prev = getAff();
  awardAff(delta);
  const ms = milestoneCrossed(prev, getAff());
  const log = getInt('theaterLogLen') ? getInt('theaterLogLen') : 0; // 占位，实际用数组
  void log;
  // 回忆录
  try {
    const raw = localStorage.getItem('petdesk:theaterLog');
    const list: { t: string; scene: string; choice: string; delta: number }[] = raw ? JSON.parse(raw) : [];
    const d = new Date();
    list.push({
      t: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      scene, choice, delta,
    });
    while (list.length > 100) list.shift();
    localStorage.setItem('petdesk:theaterLog', JSON.stringify(list));
  } catch { /* ignore */ }
  const feel = delta >= 10 ? '开心到原地转圈！' : delta >= 5 ? '偷偷美滋滋～' : delta >= 0 ? '还行吧，勉强原谅你' : delta >= -5 ? '哼，有点小失落' : '气到贴边飞行！';
  return `🎭 好感 ${delta >= 0 ? '+' : ''}${delta}　${feel}${ms > 0 ? `\n✨ 顺带跨过 ${ms} 里程碑！` : ''}`;
}

/** 读回忆录 */
export function theaterLog(): { t: string; scene: string; choice: string; delta: number }[] {
  try {
    const raw = localStorage.getItem('petdesk:theaterLog');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ================= 成就 =================
export interface Achievement { id: string; name: string; desc: string; }
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'soul', name: '灵魂契约 💖', desc: '好感度达到 3000' },
  { id: 'streak', name: '自律达人 📅', desc: '任意习惯连续打卡 7 天' },
  { id: 'blood', name: '血祭之王 🩸', desc: '累计献血 3000' },
  { id: 'focus', name: '专注大师 🍅', desc: '累计专注 20 场' },
  { id: 'water', name: '水润少年 💧', desc: '单日喝满 8 杯水' },
  { id: 'talk', name: '话痨之友 💬', desc: '和蚊子说过 50 句话' },
];

export function isAchievementUnlocked(id: string): boolean { return getBool('ach_' + id); }

/** 检查并解锁成就，返回本次新解锁的成就名 */
export function checkAchievements(): string[] {
  const unlocked: string[] = [];
  if (getAff() >= 3000 && !getBool('ach_soul')) { putBool('ach_soul', true); unlocked.push('灵魂契约 💖'); }
  if (getBloodTotal() >= 3000 && !getBool('ach_blood')) { putBool('ach_blood', true); unlocked.push('血祭之王 🩸'); }
  if (getInt('focusTotalN') >= 20 && !getBool('ach_focus')) { putBool('ach_focus', true); unlocked.push('专注大师 🍅'); }
  if (waterToday() >= 8 && !getBool('ach_water')) { putBool('ach_water', true); unlocked.push('水润少年 💧'); }
  if (talkCount() >= 50 && !getBool('ach_talk')) { putBool('ach_talk', true); unlocked.push('话痨之友 💬'); }
  return unlocked;
}

// ================= 饲养指南 =================
export function guideText(): string {
  return [
    '【基础】点=戳（嗯？）+原地向上跳一小段再落回；连点三下=拍扁（2 秒复活）；按住=摸头 +好感；拖动=搬家；双击=打开桌宠面板。',
    '【情绪】开心/生气/孤独/兴奋四维随时间漂移，主导情绪自动切换动作帧（开心→笑、生气/孤独→难过、兴奋→跳跃）。互动会即时影响心情。',
    '【模式】桌宠面板里可一键切换「专注 / 勿扰 / 工作 / jump」。jump 模式下它会待在原地，点一下跳两下；工作模式切到工作动作；勿扰时它安静不插嘴。',
    '【好感】每日上限 50；500/1500/3000＝泛泛之交→渐生情愫→亲密无间→灵魂契约；摸头/喂血/专注都能涨。',
    '【饲养】饱食度按真实时间流逝下降（白天约 12.6/小时，夜里 22-7 点掉 1.6 倍，关掉 App 的时间也照算）。点「喂食(献血)」每口随机吸 15~40 血，吸多少涨多少，18% 暴击双倍。但它有约 20% 概率耍脾气拒绝，拒绝就什么也不发生。累计献血解锁五档称号。',
    '【气泡】撞墙、滑翔这类碎碎念不会打断重要消息（AI 回复/成就/提醒会优先显示完整）。',
    '【AI】会主动搭话，节奏自己调：基准间隔 n 分钟 + 动态抖动 ±%（默认 10 分钟 ±50%），每天主动条数可设上限；有 10 轮记忆。',
    '【其他】小剧场二选一、小游戏、今日运势、成就、整蛊蚊群拍打游戏。',
  ].join('\n');
}
