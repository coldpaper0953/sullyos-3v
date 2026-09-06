import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Pet, PetGrade, PetStats, PetBattleRecord, PetMeta, CharacterProfile } from '../types';
import { safeFetchJson } from '../utils/safeApi';
import {
    PET_GRADE_BONUS, GRADE_WEIGHTS,
    rollGrade, rollStats, rollHp, rollPool,
    buildCombatant, simulateBattle, estimateOdds, PetCombatant, BattleEvent,
} from '../utils/petEngine';
import { putImageBlob, migrateDataUrlToRef, isImageValue, isBlobRef } from '../utils/blobRef';
import { processImage } from '../utils/file';
import TokenImg from '../components/os/TokenImg';
import Modal from '../components/os/Modal';

// ─── 常量 ───
const GACHA_COST = 100;
const GOLD_DEFAULT = 1000;
const STAT_POINTS_DEFAULT = 30;
const BATTLE_MAX_ROUNDS = 30;
const BATTLE_MISS_WEIGHT = 100;
const GRADE_COLORS: Record<PetGrade, string> = {
    A: 'text-amber-400 border-amber-400/60 bg-amber-400/10',
    B: 'text-violet-400 border-violet-400/60 bg-violet-400/10',
    C: 'text-sky-400 border-sky-400/60 bg-sky-400/10',
    D: 'text-emerald-400 border-emerald-400/60 bg-emerald-400/10',
    E: 'text-slate-400 border-slate-400/60 bg-slate-400/10',
};

type Tab = 'gacha' | 'library' | 'battle' | 'stats';

const PetPvpApp: React.FC = () => {
    const { closeApp, characters, apiConfig, memoryPalaceConfig, addToast, userProfile } = useOS();

    const [tab, setTab] = useState<Tab>('gacha');
    const [pets, setPets] = useState<Pet[]>([]);
    const [battles, setBattles] = useState<PetBattleRecord[]>([]);
    const [meta, setMeta] = useState<PetMeta>({ id: 'main', gold: GOLD_DEFAULT, totalStatPoints: STAT_POINTS_DEFAULT });
    const [loaded, setLoaded] = useState(false);

    // 抽奖状态
    const [gachaCharId, setGachaCharId] = useState<string>('');
    const [rolling, setRolling] = useState(false);
    const [lastRolled, setLastRolled] = useState<Pet | null>(null);
    const [lastResult, setLastResult] = useState<{ grade: PetGrade; stats: PetStats; hp: number; source: 'pool' | 'random' } | null>(null);

    // 宠物库（池子模板）编辑状态
    const [tplName, setTplName] = useState('');
    const [tplOwnerId, setTplOwnerId] = useState('');
    const [tplKaomoji, setTplKaomoji] = useState('');
    const [tplWeight, setTplWeight] = useState(30);
    const tplFileRef = useRef<HTMLInputElement>(null);
    const [tplImageRef, setTplImageRef] = useState<string | undefined>();

    // 对战状态
    const [mode, setMode] = useState<'avb' | 'avs' | 'rvr'>('avb');
    const [sideAChar, setSideAChar] = useState('');
    const [sideBChar, setSideBChar] = useState('');
    const [betSide, setBetSide] = useState<'a' | 'b' | null>(null);
    const [betAmount, setBetAmount] = useState(100);
    const [battling, setBattling] = useState(false);
    // 战斗页面：逐拍回放脚本事件流。两阶段：intro（刚匹配上，对峙画面）→ battle（战况推进）
    const [arena, setArena] = useState<null | { a: PetCombatant; b: PetCombatant; events: BattleEvent[]; winner: 'a' | 'b'; record: PetBattleRecord }>(null);
    const [arenaPhase, setArenaPhase] = useState<'intro' | 'battle'>('intro');
    const [eventIdx, setEventIdx] = useState(0);
    const logRef = useRef<HTMLDivElement>(null);
    // 战况日志自动滚到最新
    useEffect(() => {
        if (arena && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [eventIdx, arena]);
    // intro 停留 2.4s → 丝滑过渡到战况推进
    useEffect(() => {
        if (!arena || arenaPhase !== 'intro') return;
        const t = setTimeout(() => setArenaPhase('battle'), 2400);
        return () => clearTimeout(t);
    }, [arena, arenaPhase]);
    useEffect(() => {
        if (!arena || arenaPhase !== 'battle') return;
        if (eventIdx >= arena.events.length - 1) return;
        const t = setTimeout(() => setEventIdx(i => Math.min(i + 1, arena.events.length - 1)), 1200);
        return () => clearTimeout(t);
    }, [arena, arenaPhase, eventIdx]);

    const charNameOf = (id: string) => characters.find(c => c.id === id)?.name || '未知';

    // ─── 装载 ───
    useEffect(() => {
        (async () => {
            const [ps, bs, m] = await Promise.all([DB.getAllPets(), DB.getAllPetBattles(), DB.getPetMeta()]);
            setPets(ps);
            setBattles(bs);
            setMeta(m ? { ...m, id: 'main' } : { id: 'main', gold: GOLD_DEFAULT, totalStatPoints: STAT_POINTS_DEFAULT });
            if (!gachaCharId && characters[0]) setGachaCharId(characters[0].id);
            setLoaded(true);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded]);

    // 战斗页面逐拍回放计时器：每 1.2s 推进一个事件
    useEffect(() => {
        if (!arena) return;
        if (eventIdx >= arena.events.length - 1) return;
        const t = setTimeout(() => setEventIdx(i => Math.min(i + 1, arena.events.length - 1)), 1200);
        return () => clearTimeout(t);
    }, [arena, eventIdx]);

    const saveMeta = async (next: PetMeta) => { setMeta(next); await DB.savePetMeta(next); };

    const alivePets = pets.filter(p => p.kind === 'pet');
    const templates = pets.filter(p => p.kind === 'template');
    const aliveByChar = (charId: string) => alivePets.filter(p => p.ownerId === charId);
    const petOf = (id?: string) => pets.find(p => p.id === id);

    // ─── 抽奖 ───
    const doGacha = async () => {
        const charId = gachaCharId || characters[0]?.id;
        if (!charId) { addToast('先在通讯录里有一个角色', 'error'); return; }
        if (meta.gold < GACHA_COST) { addToast(`金币不足（抽奖需 ${GACHA_COST}），去对战赢金币吧`, 'error'); return; }
        setRolling(true);
        try {
            await saveMeta({ ...meta, gold: meta.gold - GACHA_COST });
            // 1. 脚本掷：品级 / 属性 / 血量 / 池子
            const grade = rollGrade();
            const stats = rollStats(meta.totalStatPoints);
            const hp = rollHp(grade);
            const tpls = templates.filter(t => t.ownerId === charId);
            const hitTpl = rollPool(tpls, BATTLE_MISS_WEIGHT);
            // 2. 调一次 API 用角色人设生成名字与描述（模型：副 API 优先，未配置回落主模型）
            const llm = memoryPalaceConfig?.lightLLM?.baseUrl ? memoryPalaceConfig.lightLLM : null;
            const useCfg = (llm && llm.baseUrl && llm.apiKey) ? llm : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
            let name = '';
            let desc = '';
            try {
                const sys = (characters.find(c => c.id === charId)?.systemPrompt || '').slice(0, 1500);
                const poolHint = hitTpl ? `这次抽中的是用户预置的宠物模板「${hitTpl.name}」，请沿用这个名字。` : '请为宠物起一个简短有趣的名字（2~6 个字）。';
                const data = await safeFetchJson(
                    `${useCfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useCfg.apiKey}` },
                        body: JSON.stringify({
                            model: useCfg.model,
                            messages: [
                                { role: 'system', content: `${sys}\n\n你是宠物抽奖系统的解签员。品级 ${grade}（攻击加成 +${PET_GRADE_BONUS[grade]}），属性：攻速 ${stats.spd}/闪避 ${stats.dodge}/暴击 ${stats.crit}（总 ${meta.totalStatPoints}），血量 ${hp}。${poolHint}\n按你的人设口吻输出两行：第一行只有宠物名字；第二行是不超过 40 字的形象描述。` },
                                { role: 'user', content: '开抽！' },
                            ],
                            temperature: 0.9, max_tokens: 300, stream: false,
                        }),
                    },
                    1, 60_000, { appName: '宠物对战', purpose: '抽卡生成' },
                );
                const data2 = await data;
                const text = (data2.choices?.[0]?.message?.content || '').trim();
                const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
                name = (lines[0] || '').replace(/^["'「」]|["'「」]$/g, '').slice(0, 12);
                desc = (lines[1] || '').slice(0, 60);
            } catch { /* API 失败 → 本地兜底名 */ }
            if (!name) {
                const fallbacks = ['咕咕兽', '毛毛球', '闪光鼠', '硬壳龟', '电电犬', '云朵鲸'];
                name = fallbacks[Math.floor(Math.random() * fallbacks.length)];
                desc = '神秘宠物（AI 没接住，纯脚本生成）';
            }
            // 3. 落库（覆盖该角色当前活宠物 = 重新生成的语义）
            const old = aliveByChar(charId);
            for (const o of old) await DB.deletePet(o.id);
            const pet: Pet = {
                id: `pet-${Date.now()}`,
                kind: 'pet',
                ownerId: charId,
                name,
                grade, stats, hp,
                desc,
                source: hitTpl ? 'pool' : 'random',
                poolTemplateId: hitTpl?.id,
                imageRef: hitTpl?.imageRef,
                kaomoji: hitTpl?.kaomoji,
                createdAt: Date.now(),
            };
            await DB.savePet(pet);
            setPets(prev => [...prev.filter(p => p.id !== pet.id), pet]);
            setLastRolled(pet);
            setLastResult({ grade, stats, hp, source: pet.source! });
            addToast(`抽到了「${name}」（${grade} 级）！`, 'success');
        } finally {
            setRolling(false);
        }
    };

    // ─── 宠物库：池子模板 ───
    const handleTplImage = async (file: File) => {
        try {
            const base64 = await processImage(file, { maxWidth: 400, quality: 0.8 });
            const ref = await migrateDataUrlToRef(base64);
            setTplImageRef(ref);
            addToast('图片已入库', 'success');
        } catch { addToast('图片处理失败', 'error'); }
    };
    const handleAddTemplate = async () => {
        const ownerId = tplOwnerId || characters[0]?.id;
        if (!tplName.trim() || !ownerId) { addToast('填好名字并绑定角色', 'error'); return; }
        const tpl: Pet = {
            id: `tpl-${Date.now()}`,
            kind: 'template',
            ownerId,
            name: tplName.trim(),
            grade: 'C', // 模板不预设品级，抽到时重掷
            stats: { spd: 10, dodge: 10, crit: 10 },
            hp: 200,
            weight: Math.max(1, tplWeight),
            imageRef: tplImageRef,
            kaomoji: tplImageRef ? undefined : (tplKaomoji.trim() || '(=ↀωↀ=)'),
            createdAt: Date.now(),
        };
        await DB.savePet(tpl);
        setPets(prev => [...prev, tpl]);
        setTplName(''); setTplKaomoji(''); setTplWeight(30); setTplImageRef(undefined);
        addToast(`宠物模板「${tpl.name}」已入池`, 'success');
    };
    const handleDeleteTemplate = async (id: string) => {
        await DB.deletePet(id);
        setPets(prev => prev.filter(p => p.id !== id));
    };

    // ─── 对战 ───
    const combatantOf = (charId: string): PetCombatant | null => {
        const pet = aliveByChar(charId)[0];
        if (!pet) return null;
        return buildCombatant(pet, charId, charNameOf(charId), meta.totalStatPoints);
    };
    const pickRandomCharWithPet = (exclude?: string) => {
        const pool = alivePets.map(p => p.ownerId).filter(id => id !== exclude);
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    };
    const resolveSides = (): [PetCombatant, PetCombatant] | null => {
        let aId = sideAChar || characters[0]?.id || '';
        let bId = mode === 'rvr' ? pickRandomCharWithPet(aId) : sideBChar;
        if (mode === 'avs' && !bId) bId = pickRandomCharWithPet(aId);
        if (aId === bId) { addToast('两边不能是同一个角色', 'error'); return null; }
        const a = combatantOf(aId);
        const b = combatantOf(bId);
        if (!a) { addToast(`${charNameOf(aId)} 还没有活着的宠物，先去抽奖`, 'error'); return null; }
        if (!b) { addToast(`${charNameOf(bId)} 还没有活着的宠物，先去抽奖`, 'error'); return null; }
        return [a, b];
    };

    const startBattle = async () => {
        const sides = resolveSides();
        if (!sides) return;
        const [a, b] = sides;
        // 押注扣钱（押了才结算）
        if (betSide && betAmount > 0) {
            if (meta.gold < betAmount) { addToast('金币不够押注', 'error'); return; }
            await saveMeta({ ...meta, gold: meta.gold - betAmount });
        }
        setBattling(true);
        try {
            // 1. 脚本模拟（战斗结果 + 赔率预演）——纯脚本，无 AI
            const result = simulateBattle(a, b, BATTLE_MAX_ROUNDS);
            const sim = estimateOdds(a, b, 200);
            const winnerCharId = result.winner === 'a' ? a.charId : b.charId;
            // 2. 押注结算
            let bet: PetBattleRecord['bet'];
            if (betSide && betAmount > 0) {
                const won = betSide === result.winner;
                const payout = Math.round(betAmount * (betSide === 'a' ? sim.oddsA : sim.oddsB));
                if (won) await saveMeta({ ...meta, gold: meta.gold - betAmount + payout });
                bet = { side: betSide, amount: betAmount, odds: betSide === 'a' ? sim.oddsA : sim.oddsB, won };
            }
            // 3. 落库：记录 + 败方宠物删除（宠物死亡只能重抽）
            const record: PetBattleRecord = {
                id: `pb-${Date.now()}`,
                aCharId: a.charId, bCharId: b.charId,
                aName: a.name, bName: b.name,
                aPetId: a.petId, bPetId: b.petId,
                rounds: result.rounds,
                winnerCharId,
                bet,
                createdAt: Date.now(),
            };
            await DB.savePetBattle(record);
            setBattles(prev => [...prev, record]);
            const loserPetId = result.winner === 'a' ? b.petId : a.petId;
            if (loserPetId) {
                await DB.deletePet(loserPetId);
                setPets(prev => prev.filter(p => p.id !== loserPetId));
            }
            if (bet) addToast(bet.won ? `押中！赢得 ${Math.round(betAmount * bet.odds)} 金币` : `押错了，损失 ${betAmount} 金币`, bet.won ? 'success' : 'error');
            // 4. 打开战斗页面：先匹配对峙画面，2.4s 后丝滑过渡到战况推进
            setArenaPhase('intro');
            setEventIdx(0);
            setArena({ a, b, events: result.events, winner: result.winner, record });
        } finally {
            setBattling(false);
        }
    };

    // ─── 宠物形象渲染 ───
    const PetVisual: React.FC<{ pet: { imageRef?: string; kaomoji?: string; name: string }, size?: string }> = ({ pet, size = 'w-14 h-14' }) => {
        if (pet.imageRef) return <TokenImg value={pet.imageRef} className={`${size} rounded-xl object-cover border border-white/10`} />;
        return (
            <div className={`${size} rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden`}>
                <span className="text-[9px] font-mono whitespace-pre text-center leading-tight text-slate-600">{pet.kaomoji || '(=ↀωↀ=)'}</span>
            </div>
        );
    };

    // ─── 战斗页面（两阶段：intro 匹配对峙 → battle 战况推进，全程 CSS 过渡丝滑衔接）───
    const renderArena = () => {
        if (!arena) return null;
        const intro = arenaPhase === 'intro';
        const ev = arena.events[Math.min(eventIdx, arena.events.length - 1)];
        const done = !intro && eventIdx >= arena.events.length - 1;
        const hpPctA = Math.max(0, Math.round((ev.hpA / Math.max(arena.a.maxHp, 1)) * 100));
        const hpPctB = Math.max(0, Math.round((ev.hpB / Math.max(arena.b.maxHp, 1)) * 100));
        const aAttacking = !intro && ev.atkSide === 'a' && (ev.kind === 'attack' || ev.kind === 'crit' || ev.kind === 'dodge');
        const bAttacking = !intro && ev.atkSide === 'b' && (ev.kind === 'attack' || ev.kind === 'crit' || ev.kind === 'dodge');
        const aHurt = !intro && ev.atkSide === 'b' && (ev.kind === 'attack' || ev.kind === 'crit' || ev.kind === 'ko');
        const bHurt = !intro && ev.atkSide === 'a' && (ev.kind === 'attack' || ev.kind === 'crit' || ev.kind === 'ko');
        const sideCard = (c: PetCombatant, isAttacking: boolean, isHurt: boolean, fromLeft: boolean) => (
            <div className={`flex-1 rounded-2xl border-2 overflow-hidden transition-all duration-700 ${
                isHurt ? 'border-rose-400 bg-rose-50'
                    : isAttacking ? 'border-amber-400 bg-amber-50 scale-[1.03] shadow-lg shadow-amber-100'
                    : 'border-[#7d7264]/30 bg-[#f6f3ec]'
            } ${intro ? (fromLeft ? 'translate-x-0 opacity-100' : 'translate-x-0 opacity-100') : 'scale-[0.94]'}`}>
                <div className="px-2 pt-2 pb-1 text-center">
                    <div className="text-[11px] font-bold text-slate-600 truncate">{c.charName}</div>
                </div>
                <div className="flex items-center justify-center py-1 px-2 min-h-[110px]">
                    {c.imageRef
                        ? <TokenImg value={c.imageRef} className="w-full h-32 object-cover rounded-lg" />
                        : <span className="text-[10px] font-mono whitespace-pre text-center leading-tight text-slate-600 break-all">{c.kaomoji || '(=ↀωↀ=)'}</span>}
                </div>
                <div className="px-2 pb-2 text-center">
                    <div className="text-xs font-bold text-slate-700 truncate">{c.name}</div>
                    <span className={`inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${GRADE_COLORS[c.grade]}`}>{c.grade} 级</span>
                </div>
            </div>
        );
        const hpBarA = (
            <div className="flex items-center gap-2 transition-opacity duration-700">
                <span className="text-xs font-black text-slate-700 w-12 text-right tabular-nums">{ev.hpA}</span>
                <div className="flex-1 h-4 bg-slate-300/70 rounded-r-full overflow-hidden border border-[#7d7264]/30">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-all duration-700 ease-out"
                        style={{ width: `${intro ? 100 : hpPctA}%`, marginLeft: 'auto' }} />
                </div>
            </div>
        );
        const hpBarB = (
            <div className="flex items-center gap-2 transition-opacity duration-700">
                <div className="flex-1 h-4 bg-slate-300/70 rounded-l-full overflow-hidden border border-[#7d7264]/30">
                    <div className="h-full bg-gradient-to-l from-emerald-400 to-emerald-300 transition-all duration-700 ease-out"
                        style={{ width: `${intro ? 100 : hpPctB}%` }} />
                </div>
                <span className="text-xs font-black text-slate-700 w-12 tabular-nums">{ev.hpB}</span>
            </div>
        );
        return (
            <div className="space-y-3">
                {/* 顶部：对向 HP 条（intro 满血入场 → battle 随战况掉血） */}
                <div className="space-y-1.5">
                    {hpBarA}
                    <div className={`text-center font-black transition-all duration-700 ${intro ? 'text-2xl text-rose-500 scale-110 tracking-widest' : 'text-[10px] text-slate-400 tracking-[0.3em]'}`}>
                        {intro ? 'VS' : '⚔ 战况'}
                    </div>
                    {hpBarB}
                </div>
                {/* 中部：双竖版宠物卡（intro 大卡对峙 → battle 缩小进入战况） */}
                <div className="flex items-stretch gap-2">
                    {sideCard(arena.a, aAttacking, aHurt, true)}
                    <div className="flex flex-col items-center justify-center px-1">
                        <span className={`font-black text-slate-300 transition-all duration-700 ${intro ? 'text-2xl text-rose-400 scale-125' : 'text-sm'}`}>VS</span>
                    </div>
                    {sideCard(arena.b, bAttacking, bHurt, false)}
                </div>
                {/* 下方：战况日志面板（intro 隐藏 → battle 滑入展开） */}
                <div className={`overflow-hidden transition-all duration-700 ease-out ${intro ? 'max-h-0 opacity-0 translate-y-6' : 'max-h-[420px] opacity-100 translate-y-0'}`}>
                    <div className="rounded-2xl border border-[#7d7264]/30 bg-[#4a4438] p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#c9bfae] mb-2 flex items-center justify-between">
                            <span>⚔ 战况</span>
                            {!done && <span className="animate-pulse"> LIVE</span>}
                        </div>
                        <div ref={logRef} className="space-y-1 max-h-44 overflow-y-auto">
                            {(() => {
                                // 已消耗的非连击事件数 = 已对应的战报行数（chain 事件不产生战报行）
                                const shown = arena.events.slice(0, eventIdx + 1).filter(e => e.kind !== 'chain').length;
                                const visible = arena.record.rounds.slice(0, Math.max(1, shown));
                                return visible.map((r, i, arr) => (
                                    <div key={i} className={`text-[10px] leading-relaxed font-mono ${i === arr.length - 1 ? 'text-amber-200 font-bold' : 'text-[#d8d0c2]'}`}>{r}</div>
                                ));
                            })()}
                        </div>
                        {!intro && ev.kind === 'crit' && <div className="text-center text-base font-black text-rose-300 animate-fade-in">暴击！-{ev.dmg}</div>}
                        {!intro && ev.kind === 'dodge' && <div className="text-center text-sm font-bold text-sky-300 animate-fade-in">闪避！</div>}
                    </div>
                </div>
                {/* 控制 */}
                {done ? (
                    <div className="space-y-2 animate-fade-in">
                        <div className="text-center text-sm font-bold text-amber-600 bg-amber-50 rounded-xl py-2">
                            🏆 {(arena.winner === 'a' ? arena.a.charName : arena.b.charName)} 的 {(arena.winner === 'a' ? arena.a.name : arena.b.name)} 获胜！
                            {arena.record.bet ? `（押注${arena.record.bet.won ? '赢' : '输'} ${arena.record.bet.amount} 金币）` : ''}
                        </div>
                        <button onClick={() => setArena(null)} className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold">关闭战斗页面</button>
                    </div>
                ) : (
                    <button onClick={() => { setArenaPhase('battle'); setEventIdx(arena.events.length - 1); }} className="w-full py-2 rounded-xl bg-slate-100 text-slate-500 text-[10px] font-bold">跳过 ▶▶</button>
                )}
            </div>
        );
    };

    if (!loaded) {
        return <div className="h-full w-full bg-slate-50 flex items-center justify-center text-sm text-slate-400">宠物对战加载中…</div>;
    }

    return (
        <div className="h-full w-full flex flex-col bg-slate-50 font-sans relative overflow-hidden">
            {/* 顶栏 */}
            <div className="shrink-0 z-10 sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-200/60" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="pt-12 pb-3 px-4 flex items-center justify-between">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">←</button>
                    <span className="font-bold text-slate-700">🐾 宠物对战</span>
                    <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">🪙 {meta.gold}</span>
                </div>
                {/* Tabs */}
                <div className="flex gap-1 px-4 pb-2">
                    {([['gacha', '抽奖'], ['library', '宠物库'], ['battle', '对战'], ['stats', '战绩']] as Array<[Tab, string]>).map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id as Tab)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === id ? 'bg-fuchsia-500 text-white shadow' : 'bg-slate-100 text-slate-500'}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
                {/* ─── 抽奖 ─── */}
                {tab === 'gacha' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-4 border border-slate-200/70">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">选择抽奖角色</label>
                            <select value={gachaCharId} onChange={e => setGachaCharId(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none">
                                {characters.map(c => <option key={c.id} value={c.id}>{c.name}{aliveByChar(c.id).length > 0 ? `（已有宠物：${aliveByChar(c.id)[0].name}）` : ''}</option>)}
                            </select>
                            <button onClick={doGacha} disabled={rolling}
                                className={`w-full mt-3 py-3 rounded-2xl font-bold text-white transition-all ${rolling ? 'bg-slate-300' : 'bg-gradient-to-r from-fuchsia-500 to-purple-500 active:scale-[0.98]'}`}>
                                {rolling ? '抽奖中…（AI 正在生成）' : `🎰 抽奖（${GACHA_COST} 金币）`}
                            </button>
                            <p className="text-[9px] text-slate-400 mt-2">品级：A(6%) B(12%) C(22%) D(30%) E(30%)；宠物死亡后该角色可重新抽奖覆盖。</p>
                        </div>
                        {lastRolled && lastResult && (
                            <div className="bg-white rounded-2xl p-4 border border-slate-200/70 animate-fade-in">
                                <div className="flex items-center gap-3">
                                    <PetVisual pet={lastRolled} size="w-16 h-16" />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800">{lastRolled.name}</span>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${GRADE_COLORS[lastResult.grade]}`}>{lastResult.grade} 级 · 攻击+{PET_GRADE_BONUS[lastResult.grade]}</span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-1">{lastRolled.desc || '…'}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                                    {[['❤ 血量', lastResult.hp], ['⚡ 攻速', lastResult.stats.spd], ['💨 闪避', lastResult.stats.dodge], ['💥 暴击', lastResult.stats.crit]].map(([label, v]) => (
                                        <div key={label as string} className="bg-slate-50 rounded-lg py-2">
                                            <div className="text-[9px] text-slate-400">{label}</div>
                                            <div className="text-sm font-bold text-slate-700">{v}</div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[9px] text-slate-400 mt-2">来源：{lastResult.source === 'pool' ? '宠物池命中' : '随机生成'} · 再次抽奖会覆盖这只宠物</p>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── 宠物库（池子模板管理）─── */}
                {tab === 'library' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-4 border border-slate-200/70">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">新建池子模板</label>
                            <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="宠物名字" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none mb-2" />
                            <select value={tplOwnerId} onChange={e => setTplOwnerId(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none mb-2">
                                <option value="">绑定角色（抽到谁）…</option>
                                {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <textarea value={tplKaomoji} onChange={e => setTplKaomoji(e.target.value)} placeholder="颜文字 / 点阵图（不传图片时显示）" rows={3}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-mono outline-none mb-2 whitespace-pre" />
                            <div className="flex items-center gap-2 mb-2">
                                <button onClick={() => tplFileRef.current?.click()} className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-600">插入图片</button>
                                {tplImageRef && <TokenImg value={tplImageRef} className="w-9 h-9 rounded-lg object-cover" />}
                                <input type="file" ref={tplFileRef} className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) handleTplImage(f); e.target.value = ''; }} />
                                <div className="flex items-center gap-1 ml-auto">
                                    <span className="text-[10px] text-slate-400">权重</span>
                                    <input type="number" min={1} value={tplWeight} onChange={e => setTplWeight(parseInt(e.target.value) || 1)} className="w-16 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none" />
                                </div>
                            </div>
                            <button onClick={handleAddTemplate} className="w-full py-2.5 rounded-xl bg-fuchsia-500 text-white text-sm font-bold active:scale-[0.98]">加入池子</button>
                            <p className="text-[9px] text-slate-400 mt-2">池子命中 = 直接获得这只预置宠物（含你设的名字和形象），品级属性照常重掷。未命中 = 随机生成新宠物。池子是概率制，永不抽空。</p>
                        </div>
                        {templates.length > 0 && (
                            <div className="space-y-2">
                                {templates.map(t => (
                                    <div key={t.id} className="bg-white rounded-2xl p-3 border border-slate-200/70 flex items-center gap-3">
                                        <PetVisual pet={t} />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-slate-700 truncate">{t.name} <span className="text-[9px] text-slate-400">权重 {t.weight}</span></div>
                                            <div className="text-[10px] text-slate-400 truncate">绑定：{charNameOf(t.ownerId)}</div>
                                        </div>
                                        <button onClick={() => handleDeleteTemplate(t.id)} className="text-slate-300 hover:text-red-400 text-lg px-1">×</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ─── 对战 ─── */}
                {tab === 'battle' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-4 border border-slate-200/70 space-y-3">
                            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                                {([['avb', 'A vs B'], ['avs', 'A vs 随机'], ['rvr', '随机 vs 随机']] as Array<[typeof mode, string]>).map(([id, label]) => (
                                    <button key={id} onClick={() => setMode(id)} className={`flex-1 py-1.5 rounded text-[10px] font-bold ${mode === id ? 'bg-white shadow text-slate-700' : 'text-slate-400'}`}>{label}</button>
                                ))}
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">A 方角色（必须有活宠物）</label>
                                <select value={sideAChar} onChange={e => setSideAChar(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none">
                                    <option value="">自动选择…</option>
                                    {characters.filter(c => aliveByChar(c.id).length > 0).map(c => <option key={c.id} value={c.id}>{c.name}（{aliveByChar(c.id)[0].name}）</option>)}
                                </select>
                            </div>
                            {mode === 'avb' && (
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">B 方角色</label>
                                    <select value={sideBChar} onChange={e => setSideBChar(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none">
                                        <option value="">选择对手…</option>
                                        {characters.filter(c => c.id !== sideAChar && aliveByChar(c.id).length > 0).map(c => <option key={c.id} value={c.id}>{c.name}（{aliveByChar(c.id)[0].name}）</option>)}
                                    </select>
                                </div>
                            )}
                            {/* 押注 */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">押注（可选）</label>
                                <div className="flex gap-2 items-center">
                                    {(['a', 'b', null] as Array<'a' | 'b' | null>).map(s => (
                                        <button key={String(s)} onClick={() => setBetSide(s)}
                                            className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${betSide === s ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500'}`}>
                                            {s === 'a' ? '押 A 赢' : s === 'b' ? (mode === 'avb' ? '押 B 赢' : '押对手赢') : '不押注'}
                                        </button>
                                    ))}
                                </div>
                                {betSide && (
                                    <input type="number" min={1} value={betAmount} onChange={e => setBetAmount(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="w-full mt-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none" />
                                )}
                                <p className="text-[9px] text-slate-400 mt-1">赔率由脚本预演 200 局的胜率决定（冷门赔得高），开战后自动结算。</p>
                            </div>
                            <button onClick={startBattle} disabled={battling}
                                className={`w-full py-3 rounded-2xl font-bold text-white transition-all ${battling ? 'bg-slate-300' : 'bg-gradient-to-r from-rose-500 to-fuchsia-500 active:scale-[0.98]'}`}>
                                {battling ? '战斗结算中…' : '⚔ 开始对战'}
                            </button>
                        </div>

                        {/* 战斗页面（逐拍回放） */}
                        {renderArena()}
                    </div>
                )}

                {/* ─── 战绩 ─── */}
                {tab === 'stats' && (
                    <div className="space-y-2">
                        {(() => {
                            const statMap: Record<string, { win: number; lose: number }> = {};
                            battles.forEach(b => {
                                statMap[b.winnerCharId] = statMap[b.winnerCharId] || { win: 0, lose: 0 };
                                statMap[b.winnerCharId].win++;
                                const loser = b.winnerCharId === b.aCharId ? b.bCharId : b.aCharId;
                                statMap[loser] = statMap[loser] || { win: 0, lose: 0 };
                                statMap[loser].lose++;
                            });
                            const rows = Object.entries(statMap).sort((x, y) => y[1].win - x[1].win);
                            if (rows.length === 0) return <div className="text-center py-16 text-sm text-slate-400">还没有对战记录，去打一场吧</div>;
                            return rows.map(([charId, s]) => (
                                <div key={charId} className="bg-white rounded-2xl p-4 border border-slate-200/70 flex items-center gap-3">
                                    <TokenImg value={characters.find(c => c.id === charId)?.avatar} className="w-10 h-10 rounded-full object-cover" />
                                    <div className="flex-1">
                                        <div className="text-sm font-bold text-slate-700">{charNameOf(charId)}</div>
                                        <div className="text-[10px] text-slate-400">总场次 {s.win + s.lose}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-emerald-500 font-bold text-sm">{s.win} 胜</div>
                                        <div className="text-rose-400 font-bold text-sm">{s.lose} 负</div>
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PetPvpApp;
