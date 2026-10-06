import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import {
  loadEmotion, saveEmotion, drift, add, mood,
  type EmotionState, type MoodName,
} from '../utils/petEmotion';
import {
  onBubble, onPrank, onStateChange, showBubble,
  getAff, awardAff, milestoneCrossed, titleFor,
  isMode, getSkinFrames, getChatLog, chatGapMin, chatJitter, chatDailyCap,
  focusTick, finishFocus, getInt, putInt, todayStr,
  getPetSize, getSpeedMul, getJumpPct, getStandLift, getGlideLevel, glideFriction,
  appSense,
  type PetAction,
} from '../utils/petStore';
import { quotesPick, quotesPickFmt, appSenseLine } from '../utils/petQuotes';
import { aiChat, type PetAIConfig } from '../utils/petAI';
import { randomEvent, checkAchievements } from '../utils/petExtras';
import PrankOverlay from './PrankOverlay';
import { IconTrophy } from './petIcons';

type Action = PetAction;

const FRAME_COUNT: Record<Action, number> = { mosquito: 5, happy: 5, sad: 5, work: 5, jump: 5, dead: 1 };

const moodToAction = (m: MoodName): Action => {
  switch (m) {
    case '开心': return 'happy';
    case '生气':
    case '孤独': return 'sad';
    case '兴奋': return 'jump';
    default: return 'mosquito';
  }
};

/** 按模式 + 情绪决定当前动作（模块级，供 rAF 循环与交互复用） */
const resolveDefaultAction = (s: EmotionState): Action => {
  if (isMode('jump')) return 'jump';
  if (isMode('work')) return 'work';
  return moodToAction(mood(s));
};

// App 感知：AppID → 吐槽类别（映射不到的 App 不出台词，与原版「其他」类一致）
const APP_SENSE_CATEGORY: Partial<Record<AppID, string>> = {
  [AppID.Chat]: '聊天', [AppID.GroupChat]: '聊天', [AppID.QQBridge]: '聊天',
  [AppID.Social]: '聊天', [AppID.Contacts]: '聊天', [AppID.Call]: '聊天',
  [AppID.Music]: '音乐', [AppID.Songwriting]: '音乐',
  [AppID.Game]: '游戏', [AppID.PetPvp]: '游戏', [AppID.Guidebook]: '游戏',
  [AppID.Browser]: '购物浏览', [AppID.Gallery]: '购物浏览',
  [AppID.XhsFreeRoam]: '购物浏览', [AppID.XhsStock]: '购物浏览', [AppID.HotNews]: '购物浏览',
};

const BASE = (import.meta.env.BASE_URL || '/') + 'pet/';
const frameUrl = (a: Action, i: number) => `${BASE}${a}_${i + 1}.png`;

const POS_KEY = 'petdesk-pet-pos';

const loadPos = (): { x: number; y: number } => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
    }
  } catch { /* ignore */ }
  const sz = getPetSize();
  return { x: window.innerWidth - sz - 16, y: window.innerHeight * 0.4 };
};

function dayCount(): number {
  const key = 'petdesk:firstAt';
  let first = Number(localStorage.getItem(key));
  if (!first) { first = Date.now(); localStorage.setItem(key, String(first)); }
  return Math.floor((Date.now() - first) / 86400000) + 1;
}

interface BubbleState { text: string; until: number; prio: number; }

// 抛掷/惯性物理常量（对齐原生 30ms 物理帧）
const FALL_GRAVITY = 1.2;     // px / 30ms
const FALL_DRAG = 0.99;       // 空气阻力
const FALL_V_SCALE = 30 / 16; // 松手速度放大系数

const FloatingPet: React.FC = () => {
  const { openApp, apiConfig, activeApp } = useOS();

  const [pos, setPos] = useState(loadPos);
  const [frame, setFrame] = useState(0);
  const [action, setAction] = useState<Action>('mosquito');
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [emotion, setEmotion] = useState<EmotionState>(loadEmotion);
  const [prank, setPrank] = useState<number | null>(null);

  const posRef = useRef(pos);
  const velRef = useRef({ vx: 2, vy: 1.2 });
  const actionRef = useRef<Action>('mosquito');
  const jumpingRef = useRef<{ baseY: number; start: number } | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const lastFrameAt = useRef(Date.now());
  const bubbleRef = useRef<BubbleState | null>(null);

  // 动态参数缓存（设置页改动时通过 onStateChange 同步）
  const sizeRef = useRef(getPetSize());
  const speedMulRef = useRef(getSpeedMul());
  const jumpPctRef = useRef(getJumpPct());
  const standLiftRef = useRef(getStandLift());
  const glideLevelRef = useRef(getGlideLevel());

  // 抛掷 / 惯性物理状态
  const fallRef = useRef<{ vx: number; vy: number; bounces: number } | null>(null);
  const glideRef = useRef<{ vx: number; vy: number } | null>(null);
  const physAtRef = useRef(Date.now());

  // 拖动速度采样
  const dragVelRef = useRef({ vx: 0, vy: 0 });
  const lastMoveRef = useRef({ x: 0, y: 0, at: Date.now() });

  // 交互状态
  const downRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const movedRef = useRef(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);
  const pressTimerRef = useRef<number | null>(null);

  // 主动搭话 / 随机事件
  const nextAutoChatAtRef = useRef(Date.now() + 60000);
  const lastInteractAtRef = useRef(Date.now());
  const lastRandomAtRef = useRef(Date.now());
  const deadUntilRef = useRef(0);
  const apiRef = useRef<PetAIConfig>(apiConfig);
  apiRef.current = apiConfig;

  // 气泡显示（带优先级：高优先级不被低优先级打断）
  const showBubbleLocal = (text: string, ms = 3000, prio = 1) => {
    const cur = bubbleRef.current;
    if (cur && cur.until > Date.now() && cur.prio > prio) return;
    bubbleRef.current = { text, until: Date.now() + ms, prio };
    setBubble({ text, until: Date.now() + ms, prio });
  };

  // 主循环：移动 + 帧动画 + 气泡过期 + 抛掷/惯性物理
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const p = posRef.current;
      const v = velRef.current;
      const SZ = sizeRef.current;
      const W = window.innerWidth - SZ;
      const H = window.innerHeight - SZ;
      const baseY = window.innerHeight - SZ - 12 - (standLiftRef.current / 100) * window.innerHeight;

      if (!draggingRef.current) {
        const dead = now < deadUntilRef.current;
        if (dead) {
          actionRef.current = 'dead';
          setAction('dead');
        } else if (jumpingRef.current) {
          const j = jumpingRef.current;
          const dt = (now - j.start) / 1000;
          const total = 0.6;
          const amp = (jumpPctRef.current / 100) * window.innerHeight;
          if (dt >= total) {
            p.y = j.baseY;
            jumpingRef.current = null;
            const act = resolveDefaultAction(loadEmotion());
            actionRef.current = act;
            setAction(act);
          } else {
            const k = Math.sin((dt / total) * Math.PI);
            p.y = j.baseY - k * amp;
          }
        } else if (fallRef.current) {
          // 抛物线扔出：竖直受重力加速，撞墙衰减反弹，落到地板摔停
          if (now - physAtRef.current >= 30) {
            physAtRef.current = now;
            const f = fallRef.current;
            f.vy += FALL_GRAVITY;
            p.x += f.vx;
            p.y += f.vy;
            f.vx *= FALL_DRAG;
            if (p.x < 0) { p.x = 0; f.vx = Math.abs(f.vx) * 0.55; }
            else if (p.x > W) { p.x = W; f.vx = -Math.abs(f.vx) * 0.55; }
            if (p.y < 40) { p.y = 40; f.vy = Math.abs(f.vy) * 0.5; }
            const floor = window.innerHeight - SZ - 60;
            if (p.y >= floor) {
              p.y = floor;
              if (f.vy > 10 && f.bounces < 2) {
                f.vy = -f.vy * 0.42;
                f.vx *= 0.7;
                f.bounces++;
              } else {
                fallRef.current = null;
                deadUntilRef.current = now + 700;   // 摔晕一小会儿
                actionRef.current = 'dead';
                setAction('dead');
                setFrame(0);
                showBubbleLocal(quotesPick('throw'), 2000, 2);
                window.setTimeout(() => {
                  if (deadUntilRef.current && Date.now() >= deadUntilRef.current - 100) {
                    deadUntilRef.current = 0;
                    const act = resolveDefaultAction(loadEmotion());
                    actionRef.current = act;
                    setAction(act);
                  }
                }, 700);
              }
            }
          }
        } else if (glideRef.current) {
          // 惯性滑行：按档位摩擦力衰减，撞边反弹，慢到停就恢复巡航
          if (now - physAtRef.current >= 30) {
            physAtRef.current = now;
            const g = glideRef.current;
            const fr = glideFriction(glideLevelRef.current);
            g.vx *= fr;
            g.vy *= fr;
            p.x += g.vx;
            p.y += g.vy;
            if (p.x < 0) { p.x = 0; g.vx = Math.abs(g.vx); }
            if (p.x > W) { p.x = W; g.vx = -Math.abs(g.vx); }
            if (p.y < 40) { p.y = 40; g.vy = Math.abs(g.vy); }
            if (p.y > H) { p.y = H; g.vy = -Math.abs(g.vy); }
            if (Math.hypot(g.vx, g.vy) < 0.15) {
              glideRef.current = null;
              const act = resolveDefaultAction(loadEmotion());
              actionRef.current = act;
              setAction(act);
            }
          }
        } else if (isMode('jump')) {
          actionRef.current = 'jump';
          setAction('jump');
          const d = baseY - p.y;
          if (Math.abs(d) > 1.5) p.y += d * 0.08;
          else p.y = baseY;
        } else if (isMode('dnd')) {
          actionRef.current = 'mosquito';
          setAction('mosquito');
          const d = baseY - p.y;
          if (Math.abs(d) > 1.5) p.y += d * 0.08;
          else p.y = baseY;
        } else if (isMode('work')) {
          actionRef.current = 'work';
          setAction('work');
        } else {
          // 巡航（速度 × 飞行速度倍率）
          const sm = speedMulRef.current;
          p.x += v.vx * sm;
          p.y += v.vy * sm;
          if (p.x < 0) { p.x = 0; v.vx = Math.abs(v.vx); }
          if (p.x > W) { p.x = W; v.vx = -Math.abs(v.vx); }
          if (p.y < 40) { p.y = 40; v.vy = Math.abs(v.vy); }
          if (p.y > H) { p.y = H; v.vy = -Math.abs(v.vy); }
          if (Math.random() < 0.02) {
            const sp = 1.5 + Math.random() * 2.5;
            const a = Math.random() * Math.PI * 2;
            v.vx = Math.cos(a) * sp;
            v.vy = Math.sin(a) * sp;
          }
        }
      }

      setPos({ x: p.x, y: p.y });

      // 帧动画：按「自定义帧数 or 内置帧数」取模播放
      if (now - lastFrameAt.current >= 100) {
        lastFrameAt.current = now;
        const fr = getSkinFrames(actionRef.current);
        const fc = fr.length || FRAME_COUNT[actionRef.current];
        setFrame(f => (f + 1) % fc);
      }

      // 气泡过期
      if (bubbleRef.current && bubbleRef.current.until < now) {
        bubbleRef.current = null;
        setBubble(null);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyAction = () => {
    const act = resolveDefaultAction(loadEmotion());
    actionRef.current = act;
    setAction(act);
  };

  // 情绪漂移 + 动作同步
  useEffect(() => {
    const id = window.setInterval(() => {
      setEmotion(prev => {
        const next = drift(prev);
        saveEmotion(next);
        if (!jumpingRef.current && Date.now() >= deadUntilRef.current && !isMode('jump') && !isMode('work')) {
          const act = moodToAction(mood(next));
          actionRef.current = act;
          setAction(act);
        }
        return next;
      });
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  // 订阅全局气泡 / 整蛊 / 状态变化（状态变化时同步动态参数）
  useEffect(() => {
    const offBubble = onBubble((text, ms, prio) => showBubbleLocal(text, ms, prio));
    const offPrank = onPrank((count) => setPrank(count));
    const offState = onStateChange(() => {
      sizeRef.current = getPetSize();
      speedMulRef.current = getSpeedMul();
      jumpPctRef.current = getJumpPct();
      standLiftRef.current = getStandLift();
      glideLevelRef.current = getGlideLevel();
    });
    return () => { offBubble(); offPrank(); offState(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主动搭话 + 随机事件 + 专注结算（30s 轮询）
  useEffect(() => {
    const check = () => {
      const now = Date.now();

      // 专注到点结算
      if (isMode('focus') && focusTick()) {
        const { msg } = finishFocus();
        awardAff(10);
        setEmotion(prev => { const n = add(prev, '兴奋', 8); saveEmotion(n); return n; });
        showBubbleLocal(msg + ' +10 好感', 5000, 3);
        return;
      }

      if (isMode('dnd') || isMode('work') || prank != null) return;
      if (now < deadUntilRef.current) return;

      // 随机事件（每 3 分钟）
      if (now - lastRandomAtRef.current > 180000) {
        lastRandomAtRef.current = now;
        const ev = randomEvent();
        if (ev) showBubbleLocal(ev, 4500, 2);
      }

      // 主动搭话
      if (now - lastInteractAtRef.current < 60000) {
        nextAutoChatAtRef.current = now + autoChatGapMs();
        return;
      }
      if (now < nextAutoChatAtRef.current) return;
      doAutoChat();
      nextAutoChatAtRef.current = now + autoChatGapMs();
    };
    const id = window.setInterval(check, 30000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prank]);

  const autoChatGapMs = () => {
    let n = chatGapMin();
    if (n < 0.5) n = 0.5;
    const jit = Math.max(0, Math.min(100, chatJitter()));
    const factor = 1 + (Math.random() * 2 - 1) * (jit / 100);
    return Math.max(30000, n * 60000 * Math.max(0.1, factor));
  };

  // App 感知：进入可吐槽的 App 时按冷却 + 概率冒一句固定台词（对齐原版 appSenseTick，仅进入时判定一次）
  const prevAppRef = useRef<AppID>(activeApp);
  useEffect(() => {
    const prev = prevAppRef.current;
    prevAppRef.current = activeApp;
    if (prev === activeApp) return;
    if (!appSense()) return;
    if (activeApp === AppID.Launcher) return;
    if (isMode('dnd') || isMode('work') || prank != null) return;
    if (Date.now() < deadUntilRef.current) return;
    const cat = APP_SENSE_CATEGORY[activeApp];
    if (!cat) return;
    const now = Date.now();
    const key = 'appsense_' + cat;
    if (now - getInt(key) < 20 * 60 * 1000) return;
    if (Math.random() >= 0.4) return;
    putInt(key, now);
    const line = appSenseLine(cat);
    if (line) showBubbleLocal(line, 4500, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeApp, prank]);

  const doAutoChat = async () => {
    const cfg = apiRef.current;
    if (!cfg.apiKey || !cfg.baseUrl) return;

    // 每日上限（0=不限），跨天清零
    const today = Number(todayStr());
    if (getInt('chatDay') !== today) { putInt('chatDay', today); putInt('chatCount', 0); }
    const cap = chatDailyCap();
    if (cap > 0 && getInt('chatCount') >= cap) { nextAutoChatAtRef.current = Date.now() + 1800000; return; }
    putInt('chatCount', getInt('chatCount') + 1);

    const topic = quotesPick('topics');
    const m = mood(loadEmotion());
    const app = activeApp ? `手抓糯米机·${activeApp}` : undefined;
    const reply = await aiChat(cfg, '主动搭话：' + topic, { mood: m, app, dayCount: dayCount(), history: getChatLog() });
    if (reply) showBubbleLocal(reply, 6000, 3);
  };

  // ---- 交互 ----
  const doTap = () => {
    lastInteractAtRef.current = Date.now();
    jumpingRef.current = { baseY: posRef.current.y, start: Date.now() };
    actionRef.current = 'jump';
    setAction('jump');
    setFrame(0);
    setEmotion(prev => { const n = add(prev, '开心', 2); saveEmotion(n); return n; });
    const { applied, capped } = awardAff(2);
    if (capped) showBubbleLocal('今天的好感已满～明天再来！', 2500, 1);
    else if (applied > 0) {
      const prev = getAff() - applied;
      const ms = milestoneCrossed(prev, getAff());
      if (ms > 0) showBubbleLocal(quotesPickFmt('milestone', { n: String(ms), t: titleFor(getAff()) }), 5000, 3);
      else showBubbleLocal(quotesPick('tap'), 1500, 1);
    }
    checkAchievements().forEach(a => showBubbleLocal(`🏆 解锁成就：${a}`, 5000, 3));
  };

  const squash = () => {
    lastInteractAtRef.current = Date.now();
    deadUntilRef.current = Date.now() + 2000;
    actionRef.current = 'dead';
    setAction('dead');
    setFrame(0);
    showBubbleLocal('你把我拍扁了！！！', 1500, 2);
    setTimeout(() => {
      if (Date.now() >= deadUntilRef.current - 100) {
        deadUntilRef.current = 0;
        applyAction();
        showBubbleLocal(quotesPick('revive'), 2500, 2);
      }
    }, 2000);
  };

  const petHead = () => {
    lastInteractAtRef.current = Date.now();
    const { applied } = awardAff(5);
    setEmotion(prev => { const n = add(prev, '开心', 4); saveEmotion(n); return n; });
    showBubbleLocal(applied > 0 ? '（舒服地蹭了蹭你）好感 +' + applied : '今天的好感已满～', 2500, 2);
    checkAchievements().forEach(a => showBubbleLocal(`🏆 解锁成就：${a}`, 5000, 3));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    downRef.current = { x: e.clientX, y: e.clientY, at: Date.now() };
    lastMoveRef.current = { x: e.clientX, y: e.clientY, at: Date.now() };
    dragVelRef.current = { vx: 0, vy: 0 };
    movedRef.current = false;
    draggingRef.current = true;
    dragOffsetRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
    // 中断进行中的抛掷/惯性/跳跃
    fallRef.current = null;
    glideRef.current = null;
    jumpingRef.current = null;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    // 长按 800ms = 摸头
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = window.setTimeout(() => {
      if (!movedRef.current && draggingRef.current) {
        draggingRef.current = false;
        petHead();
      }
    }, 800);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const now = Date.now();
    const last = lastMoveRef.current;
    const dt = now - last.at;
    if (dt > 0) {
      dragVelRef.current.vx = (e.clientX - last.x) / dt;   // px/ms
      dragVelRef.current.vy = (e.clientY - last.y) / dt;
    }
    lastMoveRef.current = { x: e.clientX, y: e.clientY, at: now };
    const dx = e.clientX - (downRef.current?.x ?? e.clientX);
    const dy = e.clientY - (downRef.current?.y ?? e.clientY);
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true;
    if (movedRef.current) {
      if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
      const x = Math.max(0, Math.min(window.innerWidth - sizeRef.current, e.clientX - dragOffsetRef.current.x));
      const y = Math.max(0, Math.min(window.innerHeight - sizeRef.current, e.clientY - dragOffsetRef.current.y));
      posRef.current = { x, y };
      setPos({ x, y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }

    if (movedRef.current) {
      // 甩动判定：快甩→抛物线扔出；普通拖放→惯性滑行；慢放→恢复巡航
      const fresh = Date.now() - lastMoveRef.current.at <= 200;
      const svx = fresh ? dragVelRef.current.vx : 0;   // px/ms
      const svy = fresh ? dragVelRef.current.vy : 0;
      const speed = Math.hypot(svx, svy) * 1000;       // px/s
      const dist = Math.hypot(e.clientX - (downRef.current?.x ?? e.clientX), e.clientY - (downRef.current?.y ?? e.clientY));
      if (dist > 60 && speed > 600) {
        fallRef.current = { vx: svx * 30 * FALL_V_SCALE, vy: svy * 30 * FALL_V_SCALE, bounces: 0 };
        physAtRef.current = Date.now();
        lastInteractAtRef.current = Date.now();
        setEmotion(prev => { const n = add(prev, '生气', 8); saveEmotion(n); return n; });
        showBubbleLocal(quotesPick('throw'), 1500, 2);
      } else if (speed > 40) {
        glideRef.current = { vx: svx * 30, vy: svy * 30 };
        physAtRef.current = Date.now();
        lastInteractAtRef.current = Date.now();
        if (speed > 267) showBubbleLocal(quotesPick('glide'), 1500, 1);
      } else {
        applyAction();
      }
      return;
    }

    // 点击：计数（1=跳，2=开面板，3=拍扁）
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => {
      const n = tapCountRef.current;
      tapCountRef.current = 0;
      if (n === 1) doTap();
      else if (n === 2) openApp(AppID.PetDesk);
      else squash();
    }, 280);
  };

  const moodName = mood(emotion);
  const frames = getSkinFrames(action);
  const skinSrc = frames.length ? frames[frame % frames.length] : frameUrl(action, frame);

  return (
    <>
      {/* 心情气泡 */}
      {bubble && (
        <div
          className="fixed z-[86] px-3 py-1.5 rounded-2xl rounded-bl-sm bg-white/95 backdrop-blur border border-black/5 shadow-md text-[12px] text-slate-700 font-medium pointer-events-none whitespace-pre-line max-w-[220px]"
          style={{ left: Math.min(pos.x + sizeRef.current / 2, window.innerWidth - 110), top: Math.max(pos.y - 34, 8), transform: 'translateX(-50%)' }}
        >
          {bubble.text.startsWith('🏆') ? (
            <span className="inline-flex items-center gap-1">
              <IconTrophy size={13} className="text-amber-500" />
              <span>{bubble.text.replace(/^🏆\s*/, '')}</span>
            </span>
          ) : bubble.text}
        </div>
      )}

      {/* 悬浮宠物本体 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`桌宠 · ${moodName}（点=戳，双击开面板，长按摸头，快甩=扔出去，拖动搬家）`}
        className="fixed z-[85] cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ left: pos.x, top: pos.y, width: sizeRef.current, height: sizeRef.current }}
      >
        <img
          src={skinSrc}
          alt="桌宠"
          draggable={false}
          className="w-full h-full object-contain pointer-events-none"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* 整蛊蚊群 */}
      {prank != null && (
        <PrankOverlay
          count={prank}
          onEnd={(report) => { setPrank(null); showBubbleLocal(report, 9000, 3); }}
        />
      )}

      {/* 侧边拉手：屏幕右缘白色小竖条（纯白 ins 风），点击打开桌宠面板 */}
      <button
        onClick={() => openApp(AppID.PetDesk)}
        title="打开桌宠面板"
        className="fixed z-[85] right-0 top-1/2 -translate-y-1/2 w-[10px] h-11 bg-white shadow-md cursor-pointer active:scale-90 transition-transform select-none touch-none"
        style={{ borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }}
      />
    </>
  );
};

export default FloatingPet;
