import React, { useEffect, useState } from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import {
  loadEmotion, saveEmotion, add, mood,
  type EmotionState, type MoodName,
} from '../utils/petEmotion';

type Action = 'mosquito' | 'happy' | 'sad' | 'work' | 'jump' | 'dead';

const BASE = (import.meta.env.BASE_URL || '/') + 'pet/';
const frameUrl = (a: Action, i: number) => `${BASE}${a}_${i + 1}.png`;

const ACTIONS: { key: Action; label: string }[] = [
  { key: 'mosquito', label: '飞行姿态' },
  { key: 'happy', label: '开心' },
  { key: 'sad', label: '难过/生气' },
  { key: 'work', label: '工作' },
  { key: 'jump', label: '跳跃' },
  { key: 'dead', label: '被拍扁' },
];

const moodEmoji: Record<MoodName, string> = {
  开心: '😊', 生气: '😠', 孤独: '😞', 兴奋: '🤩', 平静: '😐',
};

const moodDesc: Record<MoodName, string> = {
  开心: '它现在心情很好，多陪陪它会一直开心下去。',
  生气: '它有点小情绪，哄哄它吧。',
  孤独: '它想你了，快点逗逗它。',
  兴奋: '它今天特别亢奋，说不定想跟你玩。',
  平静: '它安静地待着，岁月静好。',
};

/** 桌宠面板：心情 + 互动 + 动作预览 + 聊天入口 */
const PetDeskApp: React.FC = () => {
  const { closeApp, openApp } = useOS();
  const [emotion, setEmotion] = useState<EmotionState>(loadEmotion);
  const [preview, setPreview] = useState<Action | null>(null);

  // 预览动作的帧轮播
  const [pvFrame, setPvFrame] = useState(0);
  useEffect(() => {
    if (!preview) return;
    const id = window.setInterval(() => setPvFrame(f => (f + 1) % (preview === 'dead' ? 1 : 5)), 180);
    return () => window.clearInterval(id);
  }, [preview]);

  const bump = (m: MoodName, n: number) => {
    const next = add(emotion, m, n);
    setEmotion(next);
    saveEmotion(next);
  };

  const m = mood(emotion);
  const bars: { key: keyof Pick<EmotionState, 'happy' | 'angry' | 'lonely' | 'excited'>; label: string; color: string; val: number }[] = [
    { key: 'happy', label: '开心', color: 'bg-rose-400', val: emotion.happy },
    { key: 'angry', label: '生气', color: 'bg-orange-400', val: emotion.angry },
    { key: 'lonely', label: '孤独', color: 'bg-sky-400', val: emotion.lonely },
    { key: 'excited', label: '兴奋', color: 'bg-violet-400', val: emotion.excited },
  ];

  return (
    <div className="h-full w-full bg-gradient-to-b from-emerald-50 to-white flex flex-col font-light">
      {/* Header */}
      <div className="bg-white/70 backdrop-blur-md border-b border-white/40 shrink-0" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="flex items-center px-4 py-3">
          <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-xl font-medium text-slate-700 tracking-wide">桌宠</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-20 no-scrollbar">
        {/* 心情卡片 */}
        <div className="mt-5 bg-white rounded-3xl p-5 shadow-sm border border-emerald-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl">
              {moodEmoji[m]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-slate-800">当前心情：{m}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{moodDesc[m]}</div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {bars.map(b => (
              <div key={b.key} className="flex items-center gap-2">
                <span className="w-8 text-[11px] text-slate-500 font-bold shrink-0">{b.label}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${b.color} rounded-full transition-all duration-500`} style={{ width: `${b.val}%` }} />
                </div>
                <span className="w-7 text-right text-[10px] text-slate-400 font-mono">{Math.round(b.val)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 互动 */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {([
            { label: '抚摸', desc: '开心 +8', mood: '开心' as MoodName, n: 8, cls: 'bg-rose-50 text-rose-600 border-rose-100' },
            { label: '喂食', desc: '兴奋 +8', mood: '兴奋' as MoodName, n: 8, cls: 'bg-amber-50 text-amber-600 border-amber-100' },
            { label: '陪玩', desc: '孤独 -8', mood: '孤独' as MoodName, n: -8, cls: 'bg-sky-50 text-sky-600 border-sky-100' },
          ]).map(b => (
            <button
              key={b.label}
              onClick={() => bump(b.mood, b.n)}
              className={`${b.cls} border rounded-2xl p-4 flex flex-col items-center gap-1 active:scale-95 transition-transform`}
            >
              <span className="text-sm font-bold">{b.label}</span>
              <span className="text-[10px] opacity-80">{b.desc}</span>
            </button>
          ))}
        </div>

        {/* 聊天入口 */}
        <button
          onClick={() => openApp(AppID.Chat)}
          className="mt-4 w-full bg-gradient-to-r from-emerald-400 to-teal-400 text-white rounded-2xl py-3.5 font-bold text-sm shadow-md shadow-emerald-200 active:scale-[0.98] transition-transform"
        >
          和它说说话
        </button>

        {/* 动作预览 */}
        <div className="mt-5">
          <h2 className="text-xs font-bold text-slate-400 mb-2 px-1">宠物形象（6 种动作）</h2>
          <div className="grid grid-cols-3 gap-3">
            {ACTIONS.map(a => (
              <button
                key={a.key}
                onClick={() => { setPreview(a.key); setPvFrame(0); }}
                className={`bg-white rounded-2xl border p-3 flex flex-col items-center gap-1.5 active:scale-95 transition-transform ${
                  preview === a.key ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-slate-100'
                }`}
              >
                <img
                  src={frameUrl(a.key, preview === a.key ? pvFrame : 0)}
                  alt={a.label}
                  draggable={false}
                  className="w-12 h-12 object-contain"
                />
                <span className="text-[10px] text-slate-500 font-medium">{a.label}</span>
              </button>
            ))}
          </div>
          {preview && (
            <p className="mt-3 text-center text-[10px] text-slate-400">
              {ACTIONS.find(a => a.key === preview)?.label} · 预览中（切换心情会自动换动作）
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PetDeskApp;
