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
  isMode, getSkin, getChatLog, chatGapMin, chatJitter, chatDailyCap,
  focusTick, finishFocus, getInt, putInt, todayStr,
} from '../utils/petStore';
import { quotesPick, quotesPickFmt } from '../utils/petQuotes';
import { aiChat, type PetAIConfig } from '../utils/petAI';
import { randomEvent, checkAchievements } from '../utils/petExtras';
import PrankOverlay from './PrankOverlay';

type Action = 'mosquito' | 'happy' | 'sad' | 'work' | 'jump' | 'dead';

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

const BASE = (import.meta.env.BASE_URL || '/') + 'pet/';
const frameUrl = (a: Action, i: number) => `${BASE}${a}_${i + 1}.png`;

const PET_SIZE = 72;
const JUMP_HEIGHT = 64;
const POS_KEY = 'petdesk-pet-pos';

const loadPos = (): { x: number; y: number } => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
    }
  } catch { /* ignore */ }
  return { x: window.innerWidth - PET_SIZE - 16, y: window.innerHeight * 0.4 };
};

function dayCount(): number {
  const key = 'petdesk:firstAt';
  let first = Number(localStorage.getItem(key));
  if (!first) { first = Date.now(); localStorage.setItem(key, String(first)); }
  return Math.floor((Date.now() - first) / 86400000) + 1;
}

interface BubbleState { text: string; until: number; prio: number; }

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

  // 主循环：移动 + 帧动画 + 气泡过期
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const p = posRef.current;
      const v = velRef.current;
      const W = window.innerWidth - PET_SIZE;
      const H = window.innerHeight - PET_SIZE;

      if (!draggingRef.current) {
        const dead = now < deadUntilRef.current;
        if (dead) {
          actionRef.current = 'dead';
          setAction('dead');
        } else if (jumpingRef.current) {
          const j = jumpingRef.current;
          const dt = (now - j.start) / 1000;
          const total = 0.6;
          if (dt >= total) {
            p.y = j.baseY;
            jumpingRef.current = null;
            const act = resolveDefaultAction(loadEmotion());
            actionRef.current = act;
            setAction(act);
          } else {
            const k = Math.sin((dt / total) * Math.PI);
            p.y = j.baseY - k * JUMP_HEIGHT;
          }
        } else if (isMode('jump')) {
          // jump 模式：站原地（位置由用户拖）
          actionRef.current = 'jump';
          setAction('jump');
        } else if (isMode('work')) {
          actionRef.current = 'work';
          setAction('work');
        } else {
          // 巡航
          p.x += v.vx;
          p.y += v.vy;
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

      if (now - lastFrameAt.current >= 100) {
        lastFrameAt.current = now;
        const fc = FRAME_COUNT[actionRef.current];
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

  // 订阅全局气泡 / 整蛊 / 状态变化
  useEffect(() => {
    const offBubble = onBubble((text, ms, prio) => showBubbleLocal(text, ms, prio));
    const offPrank = onPrank((count) => setPrank(count));
    const offState = onStateChange(() => { /* 好感/模式变化，UI 已各自刷新 */ });
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
    movedRef.current = false;
    draggingRef.current = true;
    dragOffsetRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
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
    const dx = e.clientX - (downRef.current?.x ?? e.clientX);
    const dy = e.clientY - (downRef.current?.y ?? e.clientY);
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true;
    if (movedRef.current) {
      if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
      const x = Math.max(0, Math.min(window.innerWidth - PET_SIZE, e.clientX - dragOffsetRef.current.x));
      const y = Math.max(0, Math.min(window.innerHeight - PET_SIZE, e.clientY - dragOffsetRef.current.y));
      posRef.current = { x, y };
      setPos({ x, y });
    }
  };

  const onPointerUp = () => {
    draggingRef.current = false;
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }
    if (!movedRef.current) {
      // 点击：计数
      tapCountRef.current += 1;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = window.setTimeout(() => {
        const n = tapCountRef.current;
        tapCountRef.current = 0;
        if (n === 1) doTap();
        else if (n === 2) openApp(AppID.PetDesk);
        else squash();
      }, 280);
    }
  };

  const moodName = mood(emotion);
  const skin = getSkin(action);

  return (
    <>
      {/* 心情气泡 */}
      {bubble && (
        <div
          className="fixed z-[86] px-3 py-1.5 rounded-2xl rounded-bl-sm bg-white/95 backdrop-blur border border-black/5 shadow-md text-[12px] text-slate-700 font-medium pointer-events-none whitespace-pre-line max-w-[220px]"
          style={{ left: Math.min(pos.x + PET_SIZE / 2, window.innerWidth - 110), top: Math.max(pos.y - 34, 8), transform: 'translateX(-50%)' }}
        >
          {bubble.text}
        </div>
      )}

      {/* 悬浮宠物本体 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={`桌宠 · ${moodName}（点=戳，双击开面板，长按摸头，拖动搬家）`}
        className="fixed z-[85] cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ left: pos.x, top: pos.y, width: PET_SIZE, height: PET_SIZE }}
      >
        <img
          src={skin || frameUrl(action, frame)}
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
    </>
  );
};

export default FloatingPet;
