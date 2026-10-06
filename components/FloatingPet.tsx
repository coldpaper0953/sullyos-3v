import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import {
  loadEmotion, saveEmotion, drift, add, mood,
  type EmotionState, type MoodName,
} from '../utils/petEmotion';

// 宠物动作：6 种（对应原嗡嗡嗡的 6 组帧）
type Action = 'mosquito' | 'happy' | 'sad' | 'work' | 'jump' | 'dead';

// 每动作有效帧数（dead 只有 1 帧，其余 5 帧）
const FRAME_COUNT: Record<Action, number> = {
  mosquito: 5, happy: 5, sad: 5, work: 5, jump: 5, dead: 1,
};

// 情绪 → 动作（生气/孤独都归到 sad，桌宠里 sad 就是「难过/生气」）
const moodToAction = (m: MoodName): Action => {
  switch (m) {
    case '开心': return 'happy';
    case '生气':
    case '孤独': return 'sad';
    case '兴奋': return 'jump';
    default: return 'mosquito';
  }
};

const BASE = (import.meta.env.BASE_URL || '/') + 'pet/';
const frameUrl = (a: Action, i: number) => `${BASE}${a}_${i + 1}.png`;

// 显示尺寸（px）
const PET_SIZE = 72;
// 跳起高度
const JUMP_HEIGHT = 64;

// 位置记忆
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

const moodText: Record<MoodName, string> = {
  开心: '嘿嘿，心情不错～', 生气: '哼，有点不爽。', 孤独: '好想你陪我玩…',
  兴奋: '今天状态超棒！', 平静: '我在呢。',
};

/**
 * 全局悬浮桌宠：一只蚊子（可用形象换肤）在 SullyOS 界面上巡航飞行。
 * - 巡航 + 撞边反弹，小概率随机转向（简化自原版 Flyer 的 cruise 状态）
 * - 点击 = 跳起再落回（简单直接）+ 开心 +2
 * - 可拖动，位置记忆在 localStorage
 * - 情绪四维随时间漂移，主导情绪切换动作帧
 * - 双击打开「桌宠」App 面板
 */
const FloatingPet: React.FC = () => {
  const { openApp } = useOS();

  const [pos, setPos] = useState(loadPos);
  const [frame, setFrame] = useState(0);
  const [action, setAction] = useState<Action>('mosquito');
  const [bubble, setBubble] = useState<string | null>(null);
  const [emotion, setEmotion] = useState<EmotionState>(loadEmotion);

  // 高频状态放 ref，避免闭包过期
  const posRef = useRef(pos);
  const velRef = useRef({ vx: 2, vy: 1.2 });
  const actionRef = useRef<Action>('mosquito');
  const jumpingRef = useRef<{ baseY: number; start: number } | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const lastFrameAt = useRef(Date.now());
  const lastTapAt = useRef(0);
  const bubbleTimer = useRef<number | null>(null);

  // 运动 + 帧动画：单条 rAF 循环
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const p = posRef.current;
      const v = velRef.current;
      const W = window.innerWidth - PET_SIZE;
      const H = window.innerHeight - PET_SIZE;

      if (!draggingRef.current) {
        if (jumpingRef.current) {
          // 跳起：正弦缓动上升再落回（0→1→0）
          const j = jumpingRef.current;
          const dt = (now - j.start) / 1000;
          const total = 0.6;
          if (dt >= total) {
            p.y = j.baseY;
            jumpingRef.current = null;
            const act = actionRef.current;
            setAction(act);
          } else {
            const k = Math.sin((dt / total) * Math.PI);
            p.y = j.baseY - k * JUMP_HEIGHT;
          }
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

      // 帧动画 100ms 一轮
      if (now - lastFrameAt.current >= 100) {
        lastFrameAt.current = now;
        const fc = FRAME_COUNT[actionRef.current];
        setFrame(f => (f + 1) % fc);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 情绪漂移：每 60s 一次，漂移后同步动作
  useEffect(() => {
    const id = window.setInterval(() => {
      setEmotion(prev => {
        const next = drift(prev);
        saveEmotion(next);
        const act = moodToAction(mood(next));
        actionRef.current = act;
        if (!jumpingRef.current) setAction(act);
        return next;
      });
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  // 位置落盘（拖动结束时）
  useEffect(() => {
    if (draggingRef.current) return;
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos]);

  const showBubble = (text: string) => {
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 2200);
  };

  // 点击 = 跳起 + 开心 +2；双击 = 打开桌宠 App
  const onTap = () => {
    const now = Date.now();
    if (now - lastTapAt.current < 320) {
      // 双击：打开面板
      lastTapAt.current = 0;
      openApp(AppID.PetDesk);
      return;
    }
    lastTapAt.current = now;

    jumpingRef.current = { baseY: posRef.current.y, start: now };
    actionRef.current = 'jump';
    setAction('jump');
    setFrame(0);

    setEmotion(prev => {
      const next = add(prev, '开心', 2);
      saveEmotion(next);
      showBubble(moodText[mood(next)]);
      return next;
    });
  };

  // 拖动
  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    dragOffsetRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - PET_SIZE, e.clientX - dragOffsetRef.current.x));
    const y = Math.max(0, Math.min(window.innerHeight - PET_SIZE, e.clientY - dragOffsetRef.current.y));
    posRef.current = { x, y };
    setPos({ x, y });
  };
  const onPointerUp = () => {
    draggingRef.current = false;
    try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }
  };

  const moodName = mood(emotion);

  return (
    <>
      {/* 心情气泡 */}
      {bubble && (
        <div
          className="fixed z-[86] px-3 py-1.5 rounded-2xl rounded-bl-sm bg-white/95 backdrop-blur border border-black/5 shadow-md text-[12px] text-slate-700 font-medium pointer-events-none whitespace-nowrap"
          style={{ left: pos.x + PET_SIZE / 2, top: pos.y - 34, transform: 'translateX(-50%)' }}
        >
          {bubble}
        </div>
      )}

      {/* 悬浮宠物本体 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onTap}
        title={`桌宠 · ${moodName}（点击逗它，双击打开面板）`}
        className="fixed z-[85] cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ left: pos.x, top: pos.y, width: PET_SIZE, height: PET_SIZE }}
      >
        <img
          src={frameUrl(action, frame)}
          alt="桌宠"
          draggable={false}
          className="w-full h-full object-contain pointer-events-none"
          style={{ imageRendering: 'auto' }}
        />
      </div>
    </>
  );
};

export default FloatingPet;
