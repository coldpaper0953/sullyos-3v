import React, { useEffect, useRef, useState } from 'react';
import { quotesGet } from '../utils/petQuotes';
import { savePrankScore, getSkin } from '../utils/petStore';

// 整蛊模式：全屏蚊群拍打游戏（从 PrankEngine.java 移植）
// 拍满 40 只或撑 10 分钟出 BOSS（35 血）；击杀达 5/20 全体躲猫猫；杀满 15 后小概率弹伪造报错；终局假蓝屏 + 救赎终蚊。

interface SwarmMos { id: number; x: number; y: number; vx: number; vy: number; size: number; }
interface Boss { x: number; y: number; hp: number; }

const SPEEDS = [3, 4, 6, 8, 11];

const BASE = (import.meta.env.BASE_URL || '/') + 'pet/';
const mosImg = (() => getSkin('mosquito'))();

interface Props {
  count?: number;
  onEnd: (report: string) => void;
}

const PrankOverlay: React.FC<Props> = ({ count = 6, onEnd }) => {
  const [swarm, setSwarm] = useState<SwarmMos[]>([]);
  const [boss, setBoss] = useState<Boss | null>(null);
  const [kills, setKills] = useState(0);
  const [wave, setWave] = useState(1);
  const [banner, setBanner] = useState<string | null>(null);
  const [fakeError, setFakeError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'playing' | 'bsod' | 'final' | 'done'>('playing');
  const [bsodPct, setBsodPct] = useState(0);
  const [finDrift, setFinDrift] = useState({ x: 0, y: 0 });

  const swarmRef = useRef<SwarmMos[]>([]);
  const bossRef = useRef<Boss | null>(null);
  const killsRef = useRef(0);
  const waveRef = useRef(1);
  const bossDefeatedRef = useRef(false);
  const startAtRef = useRef(Date.now());
  const lastPopAtRef = useRef(Date.now());
  const nextId = useRef(1);
  const phaseRef = useRef<'playing' | 'bsod' | 'final' | 'done'>('playing');

  const W = typeof window !== 'undefined' ? window.innerWidth : 360;
  const H = typeof window !== 'undefined' ? window.innerHeight : 640;

  const setPhaseBoth = (p: 'playing' | 'bsod' | 'final' | 'done') => { phaseRef.current = p; setPhase(p); };

  const showBanner = (text: string) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 2500);
  };

  const spawn = (size?: number) => {
    if (swarmRef.current.length >= 25) return;
    const sp = SPEEDS[Math.min(SPEEDS.length - 1, waveRef.current - 1)];
    const a = Math.random() * Math.PI * 2;
    const sz = size || 40 + Math.floor(Math.random() * 20);
    const m: SwarmMos = {
      id: nextId.current++,
      x: Math.random() * Math.max(1, W - sz),
      y: 60 + Math.random() * Math.max(1, H / 2),
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: sz,
    };
    swarmRef.current = [...swarmRef.current, m];
    setSwarm(swarmRef.current);
  };

  const spawnN = (n: number) => { for (let i = 0; i < n; i++) spawn(); };

  const kill = (id: number) => {
    const s = swarmRef.current.find(m => m.id === id);
    if (!s) return;
    swarmRef.current = swarmRef.current.filter(m => m.id !== id);
    setSwarm(swarmRef.current);
    killsRef.current += 1;
    setKills(killsRef.current);

    const k = killsRef.current;
    if (k <= 15 && k % 5 === 0) spawn();
    else if (k > 15 && k <= 30 && k % 10 === 0) { waveRef.current += 1; setWave(waveRef.current); onWave(); }
    else if (k > 30 && k % 5 === 0) { waveRef.current += 1; setWave(waveRef.current); onWave(); }

    // BOSS 解锁：杀满 40 或撑 10 分钟
    if (!bossDefeatedRef.current && !bossRef.current && (k >= 40 || Date.now() - startAtRef.current > 600000)) {
      spawnBoss();
    }
    // 杀满 15 只后小概率弹伪造报错
    if (k > 15 && Math.random() * 100 < 5) popFakeError();
    // 躲猫猫
    if (k === 5 || k === 20) hideAndSeek();
  };

  const onWave = () => {
    spawnN(3);
    showBanner(`🌊 第 ${waveRef.current} 波感染！速度+1 数量+3`);
  };

  const hideAndSeek = () => {
    swarmRef.current = [];
    setSwarm([]);
    showBanner('嗡～躲猫猫开始！');
    setTimeout(() => {
      if (phaseRef.current !== 'playing') return;
      spawnN(Math.min(6 + waveRef.current * 2, 10));
    }, 5000);
  };

  const popFakeError = () => {
    const es = quotesGet('fake_error');
    if (!es.length) return;
    const parts = es[Math.floor(Math.random() * es.length)].split('|');
    setFakeError(`⚠ ${parts[0]}\n${parts[1] || ''}`);
    setTimeout(() => setFakeError(null), 4000);
    spawn();
  };

  const spawnBoss = () => {
    const b: Boss = { x: W / 2 - 70, y: H / 3, hp: 35 };
    bossRef.current = b;
    setBoss(b);
    showBanner('⚠️ BOSS 出现！35 血！点它！');
  };

  const hitBoss = () => {
    if (!bossRef.current) return;
    const b = bossRef.current;
    b.hp -= 1;
    if (Math.random() * 100 < 40) {
      const n = 1 + Math.floor(Math.random() * 3);
      spawnN(n);
      showBanner(`BOSS 召唤了 ${n} 只小蚊！`);
    }
    if (b.hp <= 0) { defeatBoss(); return; }
    b.x = Math.random() * Math.max(1, W - 140);
    b.y = 60 + Math.random() * Math.max(1, H / 2);
    setBoss({ ...b });
    showBanner(`BOSS 还剩 ${b.hp} 血！`);
  };

  const defeatBoss = () => {
    bossDefeatedRef.current = true;
    bossRef.current = null;
    setBoss(null);
    if (Math.random() * 100 < 15) {
      showBanner('分身术！');
      spawnN(2);
    }
    endGame();
  };

  const endGame = () => {
    setPhaseBoth('bsod');
    setBsodPct(0);
  };

  // BSOD 假进度
  useEffect(() => {
    if (phase !== 'bsod') return;
    const id = setInterval(() => {
      setBsodPct(p => {
        const n = Math.min(100, p + Math.floor(Math.random() * 9));
        if (n >= 100) {
          clearInterval(id);
          setTimeout(() => setPhaseBoth('final'), 400);
        }
        return n;
      });
    }, 400);
    return () => clearInterval(id);
  }, [phase]);

  // 救赎终蚊漂移
  useEffect(() => {
    if (phase !== 'final') return;
    const id = setInterval(() => {
      setFinDrift({ x: Math.sin(Date.now() / 2000) * 40, y: Math.cos(Date.now() / 2500) * 25 });
    }, 50);
    return () => clearInterval(id);
  }, [phase]);

  const finish = () => {
    const report = `🪧 整蛊战报\n击杀 ${killsRef.current} 只 · 存活 ${Math.floor((Date.now() - startAtRef.current) / 1000)} 秒 · 最高第 ${waveRef.current} 波\n蚊子大军已被你终结！`;
    savePrankScore(waveRef.current, killsRef.current);
    setPhaseBoth('done');
    onEnd(report);
  };

  // 主循环：蚊群移动
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (phaseRef.current !== 'playing') { raf = requestAnimationFrame(tick); return; }
      // 周期弹报错（约 100 秒一个）
      if (Date.now() - lastPopAtRef.current > 100000) {
        lastPopAtRef.current = Date.now();
        popFakeError();
      }
      const next = swarmRef.current.map(m => {
        let { x, y, vx, vy } = m;
        x += vx; y += vy;
        let bounce = false;
        if (x < 0) { x = 0; vx = -vx; bounce = true; }
        if (x > W - m.size) { x = W - m.size; vx = -vx; bounce = true; }
        if (y < 40) { y = 40; vy = -vy; bounce = true; }
        if (y > H - m.size - 60) { y = H - m.size - 60; vy = -vy; bounce = true; }
        if (bounce && Math.random() * 100 < 30) {
          const sp = SPEEDS[Math.min(SPEEDS.length - 1, waveRef.current - 1)];
          const a = Math.random() * Math.PI * 2;
          vx = Math.cos(a) * sp; vy = Math.sin(a) * sp;
        }
        if (Math.floor(Math.random() * 500) === 0) { vx = -vx; vy = -vy; }
        return { ...m, x, y, vx, vy };
      });
      swarmRef.current = next;
      setSwarm(next);
      // 繁殖
      if (swarmRef.current.length < 6 && Math.random() * 100 < 2) spawn();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始化
  useEffect(() => {
    const n = Math.max(1, Math.min(10, count));
    for (let i = 0; i < n; i++) spawn();
    showBanner('蚊群入侵！快速点击拍打它们！拍满 40 只或撑过 10 分钟出 BOSS！');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tint = wave >= 4 ? 'invert' : wave >= 3 ? 'hue-rotate-90' : wave >= 2 ? 'hue-rotate-180' : '';

  return (
    <div className="fixed inset-0 z-[200] select-none" style={{ background: 'rgba(0,0,0,0.25)' }}>
      {/* 蚊群 */}
      {swarm.map(m => (
        <img
          key={m.id}
          src={mosImg || `${BASE}mosquito_1.png`}
          alt="蚊"
          draggable={false}
          onPointerDown={() => kill(m.id)}
          className={`absolute ${tint}`}
          style={{ left: m.x, top: m.y, width: m.size, height: m.size, imageRendering: 'auto' }}
        />
      ))}

      {/* BOSS */}
      {boss && (
        <img
          src={mosImg || `${BASE}mosquito_1.png`}
          alt="BOSS"
          draggable={false}
          onPointerDown={hitBoss}
          className="absolute"
          style={{
            left: boss.x, top: boss.y, width: 140, height: 140,
            filter: boss.hp < 15 ? 'sepia(1) saturate(5) hue-rotate(-50deg)' : 'sepia(1) saturate(3) hue-rotate(-30deg)',
          }}
        />
      )}

      {/* 顶部 HUD */}
      <div className="absolute top-0 inset-x-0 flex justify-between items-center px-4 pt-4 pointer-events-none">
        <div className="bg-white/90 rounded-full px-4 py-1.5 text-sm font-bold text-slate-700 shadow">击杀 {kills}</div>
        <button
          onClick={finish}
          className="bg-white/90 rounded-full px-4 py-1.5 text-sm font-bold text-red-500 shadow pointer-events-auto"
        >
          结束
        </button>
        <div className="bg-white/90 rounded-full px-4 py-1.5 text-sm font-bold text-slate-700 shadow">第 {wave} 波</div>
      </div>

      {/* 波次横幅 */}
      {banner && (
        <div className="absolute inset-x-0 top-24 flex justify-center pointer-events-none">
          <div className="bg-red-500 text-white font-bold text-lg px-6 py-2 rounded-xl shadow-lg">{banner}</div>
        </div>
      )}

      {/* 伪造报错 */}
      {fakeError && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="bg-white rounded-2xl shadow-xl p-5 text-sm text-slate-700 whitespace-pre-line">{fakeError}</div>
        </div>
      )}

      {/* BSOD 终局 */}
      {phase === 'bsod' && (
        <div className="absolute inset-0 flex items-start justify-center pt-[18vh]" style={{ background: 'rgb(20,60,170)' }}>
          <pre className="text-white text-base leading-relaxed whitespace-pre-wrap px-8">
            {`:(\n\n你的电脑遇到问题，需要重新拍蚊。\n\n我们只收集部分蚊子尸体信息，然后为你重启。\n\n终止代码：MOSQUITO_EXCEPTION_NOT_HANDLED\n\n完成进度：${bsodPct}%`}
          </pre>
        </div>
      )}

      {/* 救赎终蚊 */}
      {phase === 'final' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'rgb(20,60,170)' }}>
          <img
            src={mosImg || `${BASE}mosquito_1.png`}
            alt="终蚊"
            draggable={false}
            className="w-28 h-28"
            style={{ transform: `translate(${finDrift.x}px, ${finDrift.y}px)` }}
          />
          <button onClick={finish} className="mt-8 text-white text-sm bg-white/20 rounded-full px-5 py-2">
            是时候结束这一切了，点我吧
          </button>
        </div>
      )}
    </div>
  );
};

export default PrankOverlay;
