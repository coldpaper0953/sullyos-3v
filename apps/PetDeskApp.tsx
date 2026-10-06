import React, { useEffect, useState } from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import {
  loadEmotion, saveEmotion, add, mood, type EmotionState, type MoodName,
} from '../utils/petEmotion';
import {
  showBubble, getAff, titleFor, awardAff, startFeed, getSatiety, getBloodTotal, bloodTitle,
  isMode, toggleMode, getSkin, setSkin, resetSkin, resetAllSkin, PET_ACTIONS, type PetAction,
  getPersona, setPersona, PERSONA_MAX, waterToday, drinkWater, focusActive, focusText, startFocus, finishFocus,
  chatGapMin, setChatGapMin, chatJitter, setChatJitter, chatDailyCap, setChatDailyCap,
  prankScore, startPrank, tickOverTime,
} from '../utils/petStore';
import { userChat } from '../utils/petAI';
import { fortune, theater, theaterResult, theaterLog, checkAchievements, ACHIEVEMENTS, isAchievementUnlocked, guideText, miniGame } from '../utils/petExtras';
import { quotesAll, quotesLabel, quotesSave, quotesReset } from '../utils/petQuotes';
import { checkUpdate, PET_VERSION } from '../utils/petUpdate';

type Action = 'mosquito' | 'happy' | 'sad' | 'work' | 'jump' | 'dead';

const BASE = (import.meta.env.BASE_URL || '/') + 'pet/';
const frameUrl = (a: Action, i: number) => `${BASE}${a}_${i + 1}.png`;

const ACTIONS: { key: Action; label: string }[] = [
  { key: 'mosquito', label: '飞行' },
  { key: 'happy', label: '开心' },
  { key: 'sad', label: '难过' },
  { key: 'work', label: '工作' },
  { key: 'jump', label: '跳跃' },
  { key: 'dead', label: '拍扁' },
];

const moodEmoji: Record<MoodName, string> = { 开心: '😊', 生气: '😠', 孤独: '😞', 兴奋: '🤩', 平静: '😐' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
      <h2 className="text-xs font-bold text-slate-400 mb-3">{title}</h2>
      {children}
    </div>
  );
}

const PetDeskApp: React.FC = () => {
  const { closeApp, openApp, apiConfig, activeApp, addToast } = useOS();
  const [emotion, setEmotion] = useState<EmotionState>(loadEmotion);
  const [, force] = useState(0);
  const refresh = () => force(x => x + 1);

  // 状态订阅：好感/模式等变化时刷新面板
  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('petdesk-refresh', on);
    return () => window.removeEventListener('petdesk-refresh', on);
  }, []);

  const bump = (m: MoodName, n: number) => {
    const next = add(emotion, m, n);
    setEmotion(next);
    saveEmotion(next);
  };

  const m = mood(emotion);
  const aff = getAff();

  // 互动
  const doPet = () => { awardAff(8); bump('开心', 8); showBubble('（舒服地眯起眼睛）', 2000, 2); checkAchievements().forEach(a => showBubble(`🏆 解锁成就：${a}`, 5000, 3)); refresh(); };
  const doFeed = async () => {
    tickOverTime();
    const r = startFeed();
    if (r.refused) {
      showBubble(['今天不想吸你的，想去外面觅食～', '哼，刚吃过，不饿！', '别戳啦…让我缓一缓'][Math.floor(Math.random() * 3)], 3500, 2);
    } else {
      bump('兴奋', 6);
      showBubble(`${r.crit ? '✨这血也太新鲜了！！' : ''}吸了 ${r.bite} 血，饱食度 +${r.gain}（现在 ${r.satiety}/100${r.crit ? '，暴击！）' : '）'}`, 4000, 2);
      if (r.newBloodTitle) showBubble(`🎖️ 献血称号晋升：${r.newBloodTitle}`, 5000, 3);
      checkAchievements().forEach(a => showBubble(`🏆 解锁成就：${a}`, 5000, 3));
      // AI 搭话
      if (apiConfig.apiKey && apiConfig.baseUrl) {
        userChat(apiConfig, r.crit ? '用户献血给你，这次血超新鲜，你暴击吸了双倍' : '用户献血给你，你吸了一口', { mood: mood(loadEmotion()), app: activeApp }).then(reply => {
          if (reply) showBubble(reply, 6000, 3);
        });
      }
    }
    refresh();
  };
  const doPlay = () => { awardAff(5); bump('孤独', -8); showBubble('（开心地绕着你转圈）', 2000, 2); refresh(); };

  // 聊天
  const [chatInput, setChatInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const sendChat = async () => {
    const s = chatInput.trim();
    if (!s || chatting) return;
    if (!apiConfig.apiKey || !apiConfig.baseUrl) { addToast('请先在系统设置里配置 API Key', 'error'); return; }
    setChatInput('');
    setChatting(true);
    showBubble('对方正在回应中...', 60000, 3);
    const reply = await userChat(apiConfig, s, { mood: mood(loadEmotion()), app: activeApp });
    setChatting(false);
    if (reply) showBubble(reply, 6000, 3);
    else showBubble(['嗡～信号不太好，等会儿再聊', '（信号弱）先自己玩会儿…', '嗡嗡…听不清，再说一遍？'][Math.floor(Math.random() * 3)], 3000, 2);
  };

  // 运势
  const [fortuneText, setFortuneText] = useState('');
  const [aiFortune, setAiFortune] = useState(false);
  const doFortune = () => { setFortuneText(fortune()); setAiFortune(false); };
  const doAiFortune = async () => {
    if (!apiConfig.apiKey || !apiConfig.baseUrl) { addToast('请先配置 API Key', 'error'); return; }
    setFortuneText(''); setAiFortune(true);
    const r = await userChat(apiConfig, '用户想看看今天的运势，请你结合宠物口吻给一句今天的运势', { mood: mood(loadEmotion()) });
    setAiFortune(false);
    setFortuneText(r || '运势没算出来，明天再试试～');
  };

  // 小剧场
  const [scene, setScene] = useState<{ scene: string; a: string; b: string } | null>(null);
  const [sceneResult, setSceneResult] = useState('');
  const doTheater = () => {
    const t = theater();
    if (t) { setScene(t); setSceneResult(''); }
    else setSceneResult('今天没有小剧场，晚点再来吧～');
  };
  const pickTheater = (idx: number) => {
    if (!scene) return;
    setSceneResult(theaterResult(idx, scene.scene, idx === 0 ? scene.a : scene.b));
    setScene(null);
    refresh();
  };

  // 台词工坊
  const [quoteEdit, setQuoteEdit] = useState<{ key: string; text: string } | null>(null);

  // 更新检查
  const [updInfo, setUpdInfo] = useState<{ tag: string; notes: string; url: string } | null>(null);
  const [updChecking, setUpdChecking] = useState(false);
  const doCheckUpdate = async () => {
    setUpdChecking(true);
    const u = await checkUpdate();
    setUpdChecking(false);
    if (u) setUpdInfo(u);
    else addToast(`已是最新版本 v${PET_VERSION}`, 'success');
  };

  const [showGuide, setShowGuide] = useState(false);
  const [persona, setPersonaLocal] = useState(getPersona());

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

      <div className="flex-1 overflow-y-auto px-5 pb-24 no-scrollbar">
        {/* 心情 + 好感 */}
        <div className="mt-5 bg-white rounded-3xl p-5 shadow-sm border border-emerald-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl">{moodEmoji[m]}</div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-slate-800">当前心情：{m}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">好感 {aff} · 称号「{titleFor(aff)}」</div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {([['开心', emotion.happy, 'bg-rose-400'], ['生气', emotion.angry, 'bg-orange-400'], ['孤独', emotion.lonely, 'bg-sky-400'], ['兴奋', emotion.excited, 'bg-violet-400']] as const).map(([label, val, color]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-8 text-[11px] text-slate-500 font-bold shrink-0">{label}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${val}%` }} />
                </div>
                <span className="w-7 text-right text-[10px] text-slate-400 font-mono">{Math.round(val)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 互动 */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {([
            { label: '抚摸', fn: doPet, cls: 'bg-rose-50 text-rose-600 border-rose-100' },
            { label: '喂食', fn: doFeed, cls: 'bg-amber-50 text-amber-600 border-amber-100' },
            { label: '陪玩', fn: doPlay, cls: 'bg-sky-50 text-sky-600 border-sky-100' },
          ]).map(b => (
            <button key={b.label} onClick={b.fn} className={`${b.cls} border rounded-2xl p-3 flex flex-col items-center gap-1 active:scale-95 transition-transform`}>
              <span className="text-sm font-bold">{b.label}</span>
            </button>
          ))}
        </div>

        {/* 聊天 */}
        <Section title="和它说说话">
          <div className="flex items-center gap-2">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
              placeholder="跟它说点什么…"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-300"
            />
            <button onClick={sendChat} disabled={chatting} className="bg-emerald-500 text-white rounded-xl px-4 py-2 text-sm font-bold active:scale-95 transition-transform disabled:opacity-50">
              {chatting ? '…' : '发送'}
            </button>
          </div>
        </Section>

        {/* 模式 */}
        <Section title="模式">
          <div className="grid grid-cols-4 gap-2">
            {(['focus', 'dnd', 'work', 'jump'] as const).map(mode => {
              const label = mode === 'focus' ? '专注' : mode === 'dnd' ? '勿扰' : mode === 'work' ? '工作' : 'jump';
              const on = isMode(mode);
              return (
                <button key={mode} onClick={() => toggleMode(mode)} className={`rounded-xl py-2 text-xs font-bold border active:scale-95 transition-transform ${on ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                  {on ? '● ' : ''}{label}
                </button>
              );
            })}
          </div>
          {/* 专注状态 */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">专注：{focusText()}</span>
            {focusActive() ? (
              <button onClick={() => { const { msg } = finishFocus(); awardAff(10); showBubble(msg + ' +10 好感', 5000, 3); refresh(); }} className="text-xs font-bold text-emerald-600">结束专注</button>
            ) : (
              <button onClick={() => startFocus(25)} className="text-xs font-bold text-emerald-600">开始 25 分钟</button>
            )}
          </div>
        </Section>

        {/* 生活 */}
        <Section title="生活">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">今日喝水 {waterToday()}/8 杯</span>
            <button onClick={() => { const c = drinkWater(); showBubble(c >= 8 ? '💧 喝满 8 杯，达成水润少年！' : `喝到第 ${c} 杯啦～`, 2500, 2); checkAchievements().forEach(a => showBubble(`🏆 解锁成就：${a}`, 5000, 3)); refresh(); }} className="text-xs font-bold text-sky-600 bg-sky-50 border border-sky-100 rounded-xl px-3 py-1.5 active:scale-95">
              喝一杯
            </button>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">饱食度 {Math.round(getSatiety())}/100 · 累计献血 {Math.round(getBloodTotal())}（{bloodTitle()}）</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => openApp(AppID.Journal)} className="bg-slate-50 border border-slate-200 rounded-xl py-2 text-xs font-bold text-slate-600 active:scale-95">📖 交换日记</button>
            <button onClick={() => openApp(AppID.MemoryPalace)} className="bg-slate-50 border border-slate-200 rounded-xl py-2 text-xs font-bold text-slate-600 active:scale-95">🏰 记忆宫殿</button>
          </div>
        </Section>

        {/* 运势 */}
        <Section title="今日运势">
          <div className="flex gap-2">
            <button onClick={doFortune} className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs font-bold text-amber-600 active:scale-95">随机运势</button>
            <button onClick={doAiFortune} disabled={aiFortune} className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2 text-xs font-bold text-violet-600 active:scale-95 disabled:opacity-50">AI 运势</button>
          </div>
          {fortuneText && <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">{aiFortune ? '算命中…' : fortuneText}</p>}
        </Section>

        {/* 小剧场 */}
        <Section title="小剧场">
          {scene ? (
            <div>
              <p className="text-sm text-slate-700 mb-2">{scene.scene}</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => pickTheater(0)} className="bg-slate-50 border border-slate-200 rounded-xl py-2 text-xs font-bold text-slate-700 active:scale-95">A · {scene.a}</button>
                <button onClick={() => pickTheater(1)} className="bg-slate-50 border border-slate-200 rounded-xl py-2 text-xs font-bold text-slate-700 active:scale-95">B · {scene.b}</button>
              </div>
            </div>
          ) : (
            <button onClick={doTheater} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-600 active:scale-95">触发一场小剧场</button>
          )}
          {sceneResult && <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">{sceneResult}</p>}
        </Section>

        {/* 整蛊 + 成就 + 指南 */}
        <Section title="玩法">
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => startPrank(6)} className="bg-red-50 border border-red-100 rounded-xl py-2.5 text-xs font-bold text-red-600 active:scale-95">🦟 整蛊蚊群</button>
            <button onClick={() => { checkAchievements(); refresh(); }} className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 text-xs font-bold text-slate-600 active:scale-95">🏆 成就</button>
            <button onClick={() => setShowGuide(true)} className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 text-xs font-bold text-slate-600 active:scale-95">📖 饲养指南</button>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">整蛊战绩：最高第 {prankScore().bestWave} 波 · 累计击杀 {prankScore().totalKills}</div>
        </Section>

        {/* 成就列表 */}
        <Section title="成就与回忆录">
          <div className="space-y-1.5">
            {ACHIEVEMENTS.map(a => (
              <div key={a.id} className={`flex items-center justify-between text-xs ${isAchievementUnlocked(a.id) ? 'text-amber-600' : 'text-slate-400'}`}>
                <span>{a.name}</span>
                <span className="text-[10px]">{isAchievementUnlocked(a.id) ? '已解锁' : a.desc}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-slate-100 pt-2">
            <div className="text-[11px] font-bold text-slate-400 mb-1">回忆录（最近小剧场）</div>
            {theaterLog().slice(-5).reverse().map((l, i) => (
              <div key={i} className="text-[10px] text-slate-400">{l.t} · {l.choice}（好感 {l.delta >= 0 ? '+' : ''}{l.delta}）</div>
            ))}
          </div>
        </Section>

        {/* 形象自定义 */}
        <Section title="宠物形象（6 种动作换图，留空=用内置帧）">
          <div className="space-y-2">
            {ACTIONS.map(a => {
              const sk = getSkin(a.key as PetAction);
              return (
                <div key={a.key} className="flex items-center gap-2">
                  <img src={sk || frameUrl(a.key, 0)} alt={a.label} draggable={false} className="w-8 h-8 object-contain" />
                  <span className="w-10 text-xs text-slate-600 shrink-0">{a.label}</span>
                  <input
                    value={sk}
                    onChange={e => setSkin(a.key as PetAction, e.target.value)}
                    placeholder="图片 URL"
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-emerald-300"
                  />
                  {sk && <button onClick={() => resetSkin(a.key as PetAction)} className="text-[10px] text-red-400 shrink-0">清除</button>}
                </div>
              );
            })}
          </div>
          <button onClick={resetAllSkin} className="mt-2 text-[11px] text-slate-400 underline">全部恢复默认形象</button>
        </Section>

        {/* 人设 */}
        <Section title="自定义人设（留空=中性宠物口吻）">
          <textarea
            value={persona}
            onChange={e => setPersonaLocal(e.target.value)}
            placeholder="写一段宠物的人设，比如：你是一只傲娇的小蚊子…"
            className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-300 resize-none"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-400">{persona.length}/{PERSONA_MAX}</span>
            <button onClick={() => { setPersona(persona); addToast('人设已保存，立即生效', 'success'); }} className="text-xs font-bold text-emerald-600">保存</button>
          </div>
        </Section>

        {/* 主动搭话节奏 */}
        <Section title="主动搭话节奏">
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex items-center justify-between">
              <span>基准间隔（分钟）</span>
              <input type="number" value={chatGapMin()} onChange={e => setChatGapMin(Number(e.target.value))} className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-right outline-none" />
            </div>
            <div className="flex items-center justify-between">
              <span>动态抖动（%）</span>
              <input type="number" value={chatJitter()} onChange={e => setChatJitter(Number(e.target.value))} className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-right outline-none" />
            </div>
            <div className="flex items-center justify-between">
              <span>每天最多几条（0=不限）</span>
              <input type="number" value={chatDailyCap()} onChange={e => setChatDailyCap(Number(e.target.value))} className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-right outline-none" />
            </div>
          </div>
        </Section>

        {/* 台词工坊 */}
        <Section title="台词工坊（可自定义台词）">
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(quotesAll()).map(k => (
              <button key={k} onClick={() => setQuoteEdit({ key: k, text: quotesAll()[k].join('\n') })} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-600 text-left truncate active:scale-95">
                {quotesLabel(k)}
              </button>
            ))}
          </div>
          <button onClick={() => { quotesReset(); addToast('台词已恢复默认', 'success'); }} className="mt-2 text-[11px] text-slate-400 underline">恢复全部默认台词</button>
        </Section>

        {/* 更新与关于 */}
        <Section title="更新与关于">
          <div className="text-[11px] text-slate-400 mb-2">当前版本 v{PET_VERSION}</div>
          <button onClick={doCheckUpdate} disabled={updChecking} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 text-xs font-bold text-slate-600 active:scale-95 disabled:opacity-50">
            {updChecking ? '检查中…' : '检查更新'}
          </button>
          {updInfo && (
            <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
              <div className="text-xs font-bold text-amber-700">发现新版本 {updInfo.tag}</div>
              <div className="text-[11px] text-amber-600 whitespace-pre-line mt-1 max-h-32 overflow-y-auto">{updInfo.notes}</div>
              <a href={updInfo.url} target="_blank" rel="noreferrer" className="inline-block mt-2 text-xs font-bold text-white bg-amber-500 rounded-lg px-3 py-1.5">去下载安装</a>
            </div>
          )}
        </Section>
      </div>

      {/* 饲养指南弹窗 */}
      {showGuide && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setShowGuide(false)}>
          <div className="bg-white rounded-2xl p-5 max-h-[80%] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800 mb-3">📖 饲养指南</h3>
            <p className="text-sm text-slate-600 whitespace-pre-line">{guideText()}</p>
            <button onClick={() => setShowGuide(false)} className="mt-4 w-full bg-emerald-500 text-white rounded-xl py-2 text-sm font-bold">懂了</button>
          </div>
        </div>
      )}

      {/* 台词编辑弹窗 */}
      {quoteEdit && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setQuoteEdit(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-h-[80%] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800 mb-2">{quotesLabel(quoteEdit.key)}</h3>
            <textarea
              value={quoteEdit.text}
              onChange={e => setQuoteEdit({ ...quoteEdit, text: e.target.value })}
              className="flex-1 min-h-40 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none resize-none"
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setQuoteEdit(null)} className="flex-1 bg-slate-100 rounded-xl py-2 text-sm font-bold text-slate-600">取消</button>
              <button onClick={() => { quotesSave(quoteEdit.key, quoteEdit.text.split('\n')); setQuoteEdit(null); addToast('已保存', 'success'); }} className="flex-1 bg-emerald-500 text-white rounded-xl py-2 text-sm font-bold">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PetDeskApp;
