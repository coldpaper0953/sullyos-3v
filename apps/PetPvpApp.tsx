import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Pet, PetGrade, PetStats, PetBattleRecord, PetMeta, CharacterProfile } from '../types';
import { safeFetchJson, extractContent } from '../utils/safeApi';
import {
    rollGrade, rollStats, rollAtk, rollHpByGrade, rollPool,
    buildCombatant, simulateBattle, estimateOdds, PetCombatant, BattleEvent,
} from '../utils/petEngine';
import { migrateDataUrlToRef } from '../utils/blobRef';
import { processImage } from '../utils/file';
import { ContextBuilder } from '../utils/context';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import TokenImg from '../components/os/TokenImg';
import Modal from '../components/os/Modal';

// ─── 常量 ───
const GACHA_COST = 100;
const GOLD_DEFAULT = 1000;
const STAT_POINTS_DEFAULT = 30;
const BATTLE_MAX_ROUNDS = 30;
const BATTLE_MISS_WEIGHT = 100;

// 宠物点阵标准：最多 14 行 × 每行 24 字（盲文等宽，超出会歪/截断）
const DOT_MAX_LINES = 14;
const DOT_MAX_COLS = 24;
// 抽卡动画最短播放时长（ms）：user 抽卡播完即出结果卡，角色抽卡还要等 API 评价
const DIG_MIN_MS = 2800;
const DIG_INTERVAL_DEFAULT = 280;

// 点阵统计：行数 / 最宽行字符数
const dotMeasure = (raw: string) => {
    const lines = raw.replace(/\r/g, '').split('\n');
    return { lines: lines.filter(l => l.trim()).length, cols: Math.max(0, ...lines.map(l => l.length)) };
};
// 点阵是否超标准
const dotOversize = (raw: string) => {
    const m = dotMeasure(raw);
    return m.lines > DOT_MAX_LINES || m.cols > DOT_MAX_COLS;
};
// 点阵在给定容器里不歪不截断的字号（px）
const dotFontPx = (lines: number, cols: number, boxW: number, boxH: number) =>
    Math.max(2, Math.min(12, Math.min(boxW / Math.max(cols, 1), boxH / Math.max(lines, 1) / 1.15)));
// 自定义盲文切帧：空行分隔多帧，无有效帧时回落默认三帧猫
const parseAnimFrames = (raw?: string): string[] => {
    if (!raw || !raw.trim()) return DIG_FRAMES;
    const frames = raw.replace(/\r/g, '').split(/\n\s*\n/).map(f => f.replace(/^\n+|\n+$/g, '')).filter(f => f.trim());
    return frames.length ? frames : DIG_FRAMES;
};

const GRADE_COLORS: Record<PetGrade, string> = {
    A: 'text-amber-400 border-amber-400/60 bg-amber-400/10',
    B: 'text-violet-400 border-violet-400/60 bg-violet-400/10',
    C: 'text-sky-400 border-sky-400/60 bg-sky-400/10',
    D: 'text-emerald-400 border-emerald-400/60 bg-emerald-400/10',
    E: 'text-slate-400 border-slate-400/60 bg-slate-400/10',
};

// 默认抽卡动画：盲文点阵数码猫三帧轮换（可在设置里改为自定义盲文或图片 URL）
const DIG_FRAMES: string[] = [
    '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡀\n⠀⠀⠀⠀⠀⠀⠀⠀⣠⡾⠛⢷⣄⣀⣀⡴⠟⠛⣧⡀\n⠀⠀⠀⠀⠀⠀⣠⡾⠋⠀⠀⠀⠈⠉⠁⠀⠀⠀⠈⠻⢷⣄\n⠀⠀⠀⠀⠀⣾⠋⠀⠀⢀⣤⣄⠀⠀⠀⣠⣤⡄⠀⠀⠀⠹⣷\n⠀⠀⠀⠀⢸⡏⠀⠀⠀⢿⣧⣿⠇⣀⠘⢿⣶⡿⠀⠀⠀⠀⣿\n⠀⠀⠀⠀⢸⣧⠀⠀⠀⠀⠈⠁⠘⠛⠃⠀⠁⠀⠀⠀⠀⣰⡿\n⠀⠀⠀⠀⠀⠙⢧⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣼⠟\n⠀⠀⠀⠀⠀⠀⠀⠉⠻⠶⣶⣶⣴⣤⣶⣶⣶⠾⠿⠋',
    '⠀⠀⠀⠀⠀⠀⣄⠀⠀⠀⢀⡀\n⠀⠀⠀⠀⢠⡞⠉⢳⠀⠀⠻⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⣴⠟⠙⣠\n⠀⠀⠀⠀⠀⠙⠖⠉⠀⠀⣠⣤⣤⣄⠀⠀⠀⢀⣤⣶⣤⡄⠀⠙⢦⡴⠋\n⠀⠀⠀⠀⠀⡀⠀⠀⢠⣶⡿⠋⠙⠿⣶⣶⣶⠿⠋⠉⠹⣷⣤⡄⠀⠀⣠⣄\n⠀⠀⠀⠀⠀⠁⢀⣴⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⢿⣦⡀⠙⠋\n⠀⠀⠀⠀⠀⣠⣿⠋⠀⠀⢠⣶⣶⣦⠀⠀⢀⣴⣶⣦⡀⠀⠀⠀⢹⣿\n⠀⠀⠀⠀⠀⣿⡏⠀⠀⠀⢿⣿⣾⣿⢃⣀⡸⣿⣿⣿⡟⠀⠀⠀⠀⣿\n⠀⠀⠀⠀⠀⣿⣷⠀⠀⠀⠀⠉⠉⠁⠿⠿⠟⠈⠉⠉⠀⠀⠀⠀⣸⣿\n⠀⠀⠀⠀⠀⠙⢿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⠇\n⠀⠀⠀⠀⠀⣀⠀⠙⠿⣶⣦⣤⣤⣀⣀⣀⣠⣤⣤⣤⣶⣾⠿⠛⠁⠀⡄\n⠀⠀⠀⠀⠀⠀⠀⣤⡀⠈⠉⠛⠛⠛⠛⠛⠛⠛⠛⠋⠉⠉⠀⢠⣤⡀\n⠀⠀⠀⠀⠀⠰⣆⠀⣱⠀⠀⠀⠀⠀⠐⠀⠀⠀⢴⣶⠄⠀⢶⣎⠀⢸⠆\n⠀⠀⠀⠀⠀⠀⠈⠓⠋⠀⠀⠚⠀⠀⠀⠀⠀⠀⠀⠛⠀⠀⠀⠙⠖⠁',
    '⠀⠀⠀⠀⠀⢀⣄⠀⠀⠀⣠⣄⠀⠀⠀⠀⠰⠆⠀⠀⠀⣀⠀⠀⣀⣀\n⠀⠀⠀⠀⣴⣿⠛⣷⠀⠀⠻⠟⠀⠀⠠⠄⠀⠀⠀⠀⠀⠉⢀⣴⡟⢻⣤⡀\n⠀⠀⠀⠀⠈⠹⡿⠋⠀⠀⣠⣤⣤⣄⠀⠀⠀⢀⣤⣾⣦⡄⠈⠹⣷⣾⠟⠁\n⠀⠀⠀⠀⢀⣀⠀⠀⢠⣾⡿⠋⠛⠿⣷⣶⣶⠿⠛⠉⠻⣷⣤⡄⠈⠁⣠⣄\n⠀⠀⠀⠀⠈⠁⢀⣶⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⢿⣶⡀⠹⠏\n⠀⠀⠀⠀⠀⣰⣿⠏⠀⠀⣠⣶⣷⣦⡀⠀⢀⣴⣶⣶⣄⠀⠀⠀⢹⣿⡆\n⠀⠀⠀⠀⠀⣿⣿⠀⠀⠀⢿⣿⣿⣿⣇⣀⣸⣿⣿⣿⡿⠀⠀⠀⠀⣿⡇\n⠀⠀⠀⠀⠀⣿⣿⠀⠀⠀⠀⠉⠉⠉⠿⠿⠿⠈⠉⠉⠀⠀⠀⠀⣸⣿⠇\n⠀⠀⠀⠀⠀⠙⢿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣾⣿⠇\n⠀⠀⠀⠀⢀⣀⠀⠙⠿⣷⣶⣤⣤⣤⣤⣤⣤⣤⣤⣴⣶⣾⡿⠛⠁⠀⡆\n⠀⠀⠀⠀⠀⠀⢠⣤⡀⠈⠉⠛⠛⠛⠛⠛⠛⠛⠛⠋⠉⠉⠀⢠⣤⣄',
];

// ─── 提示词模板默认值（可在设置里编辑，占位符调用时替换）───
const PROMPT_GACHA_DEFAULT = `{人设}

你刚刚花了 100 金币参加了宠物抽奖，开奖结果如下：
宠物名字：{名字}（{品级} 级 · 攻击 {攻击}）
敏捷 {敏捷} / 闪避 {闪避} / 暴击 {暴击}
血量：{血量}

请用你自己的口吻，对这次抽奖结果发表一句评价（一两句话，40 字以内），直接输出评价本身，不要输出其他内容。`;

const PROMPT_BATTLE_DEFAULT = `{A人设}

{B人设}

刚刚，{A主人} 的宠物「{A名}」与 {B主人} 的宠物「{B名}」发生了一场对战，结果 {胜者} 获胜。

【A 方宠物】{A宠物}
【B 方宠物】{B宠物}

【脚本战报（结果已定，照着写）】
{脚本战报}

请按以下格式输出（共 2~4 段，不要输出其他内容）：
第一段：{败者主人}（{败者角色}）对战败发表一两句评价；
之后：{胜者主人}（{胜者角色}）回复两三句。`;

type Tab = 'gacha' | 'pets' | 'battle' | 'stats';

const PetPvpApp: React.FC = () => {
    const { closeApp, characters, apiConfig, memoryPalaceConfig, addToast, userProfile, updateCharacter } = useOS();

    const [tab, setTab] = useState<Tab>('gacha');
    const [pets, setPets] = useState<Pet[]>([]);
    const [battles, setBattles] = useState<PetBattleRecord[]>([]);
    const [meta, setMeta] = useState<PetMeta>({ id: 'main', goldByChar: {}, totalStatPoints: STAT_POINTS_DEFAULT });
    const [loaded, setLoaded] = useState(false);

    // 抽奖状态
    const [gachaCharId, setGachaCharId] = useState<string>('user');
    const [lastRolled, setLastRolled] = useState<Pet | null>(null);
    const [lastEval, setLastEval] = useState('');
    const [drawing, setDrawing] = useState(false);
    // 抽卡两张弹窗：animScene=盲文翻找动画（点抽签立即出现）/ resultModal=结果介绍卡（动画消失后另开一张）
    const [animScene, setAnimScene] = useState<null | { pet: Pet }>(null);
    const [resultModal, setResultModal] = useState<null | { pet: Pet }>(null);
    const [digFrame, setDigFrame] = useState(0);
    const animStartRef = useRef(0);

    // 宠物库（池子模板）编辑状态
    const [tplName, setTplName] = useState('');
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
    const [arena, setArena] = useState<null | { a: PetCombatant; b: PetCombatant; events: BattleEvent[]; winner: 'a' | 'b'; record: PetBattleRecord }>(null);
    const [arenaPhase, setArenaPhase] = useState<'intro' | 'battle'>('intro');
    const [eventIdx, setEventIdx] = useState(0);
    const logRef = useRef<HTMLDivElement>(null);
    const [battling, setBattling] = useState(false);

    const charNameOf = (id: string) => id === 'user' ? (userProfile.name || '我') : (characters.find(c => c.id === id)?.name || '未知');
    const charAvatarOf = (id: string) => id === 'user' ? userProfile.avatar : characters.find(c => c.id === id)?.avatar;
    // 参与者名单：用户本人（可抽奖/参战）+ 所有 AI 角色
    const participants = useMemo(() => ([
        { id: 'user', name: userProfile.name || '我', avatar: userProfile.avatar },
        ...characters.map(c => ({ id: c.id, name: c.name, avatar: c.avatar })),
    ]), [characters, userProfile]);

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
    // 抽卡动画弹窗打开期间：盲文帧按设定间隔轮换（每帧毫秒可在设置里调）
    useEffect(() => {
        if (!animScene) return;
        const rot = setInterval(() => setDigFrame(f => f + 1), meta.drawAnimInterval || DIG_INTERVAL_DEFAULT);
        return () => clearInterval(rot);
    }, [animScene, meta.drawAnimInterval]);
    useEffect(() => {
        if (!arena || arenaPhase !== 'battle') return;
        if (eventIdx >= arena.events.length - 1) return;
        const t = setTimeout(() => setEventIdx(i => Math.min(i + 1, arena.events.length - 1)), 1200);
        return () => clearTimeout(t);
    }, [arena, arenaPhase, eventIdx]);

    // ─── 装载 ───
    useEffect(() => {
        (async () => {
            const [ps, bs, m] = await Promise.all([DB.getAllPets(), DB.getAllPetBattles(), DB.getPetMeta()]);
            setPets(ps);
            setBattles(bs);
            const loadedMeta = m ? { ...m, id: 'main' } : { id: 'main', goldByChar: {}, totalStatPoints: STAT_POINTS_DEFAULT };
            // 旧版单金币迁移：gold → goldByChar.user
            if (!loadedMeta.goldByChar && typeof (loadedMeta as any).gold === 'number') {
                loadedMeta.goldByChar = { user: (loadedMeta as any).gold };
            }
            setMeta(loadedMeta);
            setLoaded(true);
        })();
    }, []);

    const saveMeta = async (next: PetMeta) => { setMeta(next); await DB.savePetMeta(next); };
    // 独立金币：每个角色自己的钱包（'user' = 玩家本人）
    const goldOf = (id: string) => meta.goldByChar?.[id] ?? GOLD_DEFAULT;
    const setGoldOf = async (id: string, v: number) => {
        const next = { ...meta, goldByChar: { ...(meta.goldByChar || {}), [id]: v } };
        setMeta(next);
        await DB.savePetMeta(next);
    };

    const alivePets = pets.filter(p => p.kind === 'pet');
    const templates = pets.filter(p => p.kind === 'template');
    const aliveByChar = (charId: string) => alivePets.filter(p => p.ownerId === charId);

    // ─── AI 模型选择：sub=副API（默认，未配置回落主模型）/ main=主聊天模型 ───
    const pickModel = () => {
        const llm = memoryPalaceConfig?.lightLLM?.baseUrl ? memoryPalaceConfig.lightLLM : null;
        if (meta.modelMode !== 'main' && llm && llm.baseUrl && llm.apiKey) return llm;
        return { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
    };

    // 角色提示词组装（借鉴群聊：人设 + 核心上下文 + 记忆宫殿 + 近期记忆）
    const buildCharPrompt = async (charId: string) => {
        if (charId === 'user') return `【用户本人】${userProfile.name || '我'}（你就是用户本人，用户的口吻随意自然）`;
        const char = characters.find(c => c.id === charId);
        if (!char) return '';
        let core = '';
        try { core = ContextBuilder.buildCoreContext(char, userProfile); } catch { /* ignore */ }
        let palace = '';
        try { palace = String(await injectMemoryPalace(char, undefined, '宠物对战') || ''); } catch { /* ignore */ }
        const memRaw = (char as any).memories;
        const tail = Array.isArray(memRaw) ? memRaw.slice(-8).join('\n') : String(memRaw || '').split('\n').slice(-10).join('\n');
        return `【人设】${(char.systemPrompt || '').slice(0, 800)}\n【核心上下文】${core.slice(0, 700)}\n【记忆宫殿】${palace.slice(0, 500)}\n【近期记忆】${tail.slice(0, 350)}`;
    };

    // ─── 抽奖（脚本出结果；角色抽卡调一次 API 让角色评价；user 抽卡纯脚本）───
    const doGacha = async () => {
        const charId = gachaCharId || 'user';
        const charGold = goldOf(charId);
        if (charGold < GACHA_COST) { addToast(`${charNameOf(charId)} 金币不足（抽奖需 ${GACHA_COST}）`, 'error'); return; }
        // 1. 脚本掷：品级 / 攻击 / 属性 / 血量 / 池子（池子是全局的，不分角色）
        const grade = rollGrade();
        const atk = rollAtk(grade);
        const stats = rollStats(meta.totalStatPoints);
        const hp = rollHpByGrade(grade);
        const hitTpl = rollPool(templates, BATTLE_MISS_WEIGHT);
        // 2. 本地词库起名 + 按品级/最高属性生成描述
        const NAME_PREFIX = ['闪电', '月光', '暴走', '铁壳', '云朵', '暗影', '元气', '咕咕', '星尘', '荧光', '蹦跳', '贪睡'];
        const NAME_SUFFIX = ['兽', '喵', '犬', '鼠', '鲸', '龟', '狐', '鸟', '球', '蜥'];
        const GRADE_FLAVOR: Record<PetGrade, string> = { A: '传说级品质', B: '相当能打', C: '中规中矩', D: '勉强能用', E: '纯图一乐' };
        const typeOf = (s: PetStats) => {
            const top = Math.max(s.spd, s.dodge, s.crit);
            if (top === s.spd) return '敏捷型';
            if (top === s.dodge) return '闪避流';
            return '暴击流';
        };
        const name = hitTpl ? hitTpl.name : `${NAME_PREFIX[Math.floor(Math.random() * NAME_PREFIX.length)]}${NAME_SUFFIX[Math.floor(Math.random() * NAME_SUFFIX.length)]}`;
        const desc = `${GRADE_FLAVOR[grade]} · ${typeOf(stats)}${hitTpl ? '（池子命中）' : ''}`;
        // 3. 扣抽者自己的金币 + 新增宠物（多只共存，不覆盖旧的）
        await setGoldOf(charId, charGold - GACHA_COST);
        const pet: Pet = {
            id: `pet-${Date.now()}`,
            kind: 'pet',
            ownerId: charId,
            name,
            grade,
            atk,
            stats, hp,
            desc,
            source: hitTpl ? 'pool' : 'random',
            poolTemplateId: hitTpl?.id,
            imageRef: hitTpl?.imageRef,
            kaomoji: hitTpl?.kaomoji,
            createdAt: Date.now(),
        };
        await DB.savePet(pet);
        setPets(prev => [...prev, pet]);
        setLastRolled(pet);
        setLastEval('');
        // 4. 动画弹窗立即出现（不等任何调用），最短播 DIG_MIN_MS；结果卡另开一张
        animStartRef.current = Date.now();
        setAnimScene({ pet });
        // 5. 角色抽卡 → 后台调一次 API 让角色用自己口吻评价（user 抽卡不调，播完直接出结果卡）
        const minPlay = new Promise<void>(r => setTimeout(r, Math.max(0, DIG_MIN_MS - (Date.now() - animStartRef.current))));
        const openResult = (evalText: string) => {
            if (evalText) { pet.evalText = evalText; DB.savePet(pet).catch(() => {}); setLastEval(evalText); }
            setAnimScene(null);
            setResultModal({ pet: { ...pet } });
        };
        if (charId === 'user') {
            await minPlay;
            openResult('');
            return;
        }
        setDrawing(true);
        try {
            const evalPromise = (async () => {
                try {
                    const persona = await buildCharPrompt(charId);
                    const prompt = (meta.promptGacha || PROMPT_GACHA_DEFAULT)
                        .split('{人设}').join(persona)
                        .split('{名字}').join(name)
                        .split('{品级}').join(grade)
                        .split('{攻击}').join(String(atk))
                        .split('{敏捷}').join(String(stats.spd))
                        .split('{闪避}').join(String(stats.dodge))
                        .split('{暴击}').join(String(stats.crit))
                        .split('{血量}').join(String(hp));
                    const cfg = pickModel();
                    const data = await safeFetchJson(
                        `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                            body: JSON.stringify({
                                model: cfg.model,
                                messages: [
                                    { role: 'system', content: prompt },
                                    { role: 'user', content: '开抽！' },
                                ],
                                temperature: 0.9, max_tokens: 1024, stream: false,
                            }),
                        },
                        1, 60_000, { appName: '宠物对战', purpose: '抽卡评价' },
                    );
                    const d2 = await data;
                    // 思考模型（glm 等）会把额度花在 reasoning 上：extractContent 回落 reasoning_content/剥思维链
                    return extractContent(d2).slice(0, 120);
                } catch { return ''; /* 评价失败不影响宠物 */ }
            })();
            const [evalText] = await Promise.all([evalPromise, minPlay]);
            openResult(evalText);
        } finally {
            setDrawing(false);
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
        if (!tplName.trim()) { addToast('填好宠物名字', 'error'); return; }
        if (!tplImageRef && tplKaomoji.trim() && dotOversize(tplKaomoji)) { addToast(`点阵太大了：最多 ${DOT_MAX_LINES} 行 × ${DOT_MAX_COLS} 字/行，超出会歪`, 'error'); return; }
        const tpl: Pet = {
            id: `tpl-${Date.now()}`,
            kind: 'template',
            ownerId: 'pool', // 模板不绑定角色：谁抽到归谁
            name: tplName.trim(),
            grade: 'C', // 模板不预设品级，抽到时重掷
            atk: 0, // 模板不预设攻击，抽到时按品级重掷
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

    // ─── 默认宠物：每角色一只默认出战；默认死了按抽取时间自动顺延到下一只活的 ───
    const defaultPetOf = (charId: string): Pet | null => {
        const list = aliveByChar(charId).slice().sort((a, b) => a.createdAt - b.createdAt);
        const defId = meta.defaultPetByChar?.[charId];
        return list.find(p => p.id === defId) || list[0] || null;
    };
    const setDefaultPet = async (charId: string, petId: string) => {
        const next = { ...meta, defaultPetByChar: { ...(meta.defaultPetByChar || {}), [charId]: petId } };
        setMeta(next);
        await DB.savePetMeta(next);
    };

    // ─── 对战 ───
    const combatantOf = (charId: string): PetCombatant | null => {
        const pet = defaultPetOf(charId);
        if (!pet) return null;
        return buildCombatant(pet, charId, charNameOf(charId), meta.totalStatPoints);
    };
    const pickRandomCharWithPet = (exclude?: string) => {
        const pool = alivePets.map(p => p.ownerId).filter(id => id !== exclude);
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    };
    const resolveSides = (): [PetCombatant, PetCombatant] | null => {
        const owners = alivePets.map(p => p.ownerId);
        let aId = sideAChar || 'user';
        let bId = mode === 'rvr' ? pickRandomCharWithPet(aId) : sideBChar;
        if (mode === 'avs' && !bId) bId = pickRandomCharWithPet(aId);
        if (aId === bId) { addToast('两边不能是同一个角色', 'error'); return null; }
        // 自动兜底：任一方没有活宠物 → 从有宠物的人里补位（rand 模式/用户没宠物时都能开战）
        if (!combatantOf(aId)) {
            const alt = owners.find(id => id !== bId && combatantOf(id));
            if (!alt) { addToast('没有任何角色有活宠物，先去抽奖', 'error'); return null; }
            aId = alt;
        }
        if (!combatantOf(bId) || bId === aId) {
            const alt = owners.find(id => id !== aId && combatantOf(id));
            if (!alt) { addToast('没有第二个有宠物的角色，先去抽奖', 'error'); return null; }
            bId = alt;
        }
        const a = combatantOf(aId);
        const b = combatantOf(bId);
        if (!a || !b) return null;
        return [a, b];
    };

    // 战报记忆压缩：把上一场（及所有未压缩的）战报压成一句话记忆，追加进双方角色的记忆
    const compressPendingBattleMemories = async () => {
        const pending = battles.filter(b => !(b as any).memorySaved);
        for (const b of pending) {
            const oneLiner = `${new Date(b.createdAt).toLocaleDateString('zh-CN')}，${b.aName}（${charNameOf(b.aCharId)}）与 ${b.bName}（${charNameOf(b.bCharId)}）进行了宠物对战，${charNameOf(b.winnerCharId)} 的宠物获胜。`;
            for (const cid of [b.aCharId, b.bCharId]) {
                const char = characters.find(c => c.id === cid) as any;
                if (!char) continue;
                const memRaw = char.memories;
                const tail = Array.isArray(memRaw) ? memRaw.slice(-29) : String(memRaw || '').split('\n').slice(-29);
                const nextMem = Array.isArray(memRaw) ? [...tail, oneLiner] : [...tail, oneLiner];
                updateCharacter(cid, { memories: nextMem });
            }
            b.memorySaved = true;
            await DB.savePetBattle(b);
        }
    };

    const startBattle = async () => {
        const sides = resolveSides();
        if (!sides) return;
        const [a, b] = sides;
        // 押注扣钱（押了才结算，用你自己的金币）
        if (betSide && betAmount > 0) {
            const userGold = goldOf('user');
            if (userGold < betAmount) { addToast('你的金币不够押注', 'error'); return; }
            await setGoldOf('user', userGold - betAmount);
        }
        setBattling(true);
        try {
            // 0. 先把之前未压缩的战报压成一句话记忆（借鉴群聊：App 里看流水、脑子里留摘要）
            await compressPendingBattleMemories();
            // 1. 脚本模拟（战斗结果 + 赔率预演）——纯脚本，无 AI
            const result = simulateBattle(a, b, BATTLE_MAX_ROUNDS);
            const sim = estimateOdds(a, b, 200);
            const winnerCharId = result.winner === 'a' ? a.charId : b.charId;
            const loserCharId = result.winner === 'a' ? b.charId : a.charId;
            // 2. 押注结算
            let bet: PetBattleRecord['bet'];
            if (betSide && betAmount > 0) {
                const userGold = goldOf('user');
                const won = betSide === result.winner;
                const payout = Math.round(betAmount * (betSide === 'a' ? sim.oddsA : sim.oddsB));
                await setGoldOf('user', won ? userGold - betAmount + payout : userGold - betAmount);
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
            // 4. 打开战斗页面逐拍回放，结束后 AI 生成「败方评价 + 胜方回复」
            setEventIdx(0);
            setArenaPhase('intro');
            setArena({ a, b, events: result.events, winner: result.winner, record });
        } finally {
            setBattling(false);
        }
    };

    // 战斗回放结束 → 调一次 API 生成「败方评价 + 胜方回复」（完整战报当场可见）
    useEffect(() => {
        if (!arena || arenaPhase !== 'battle' || arena.record.narration) return;
        if (eventIdx < arena.events.length - 1) return;
        (async () => {
            const { a, b, record } = arena;
            const cfg = pickModel();
            try {
                const personaA = await buildCharPrompt(a.charId);
                const personaB = await buildCharPrompt(b.charId);
                const loser = record.winnerCharId === a.charId ? b : a;
                const winner = record.winnerCharId === a.charId ? a : b;
                const petSheet = (c: PetCombatant) => `宠物「${c.name}」（${c.grade}级 · 攻击 ${c.atk} · 敏捷 ${c.spd}/闪避 ${c.dodge}/暴击 ${c.crit} · HP ${c.maxHp}）`;
                const prompt = (meta.promptBattle || PROMPT_BATTLE_DEFAULT)
                    .split('{A人设}').join(personaA)
                    .split('{B人设}').join(personaB)
                    .split('{A主人}').join(a.charId === 'user' ? (userProfile.name || '我') : a.charName)
                    .split('{B主人}').join(b.charId === 'user' ? (userProfile.name || '我') : b.charName)
                    .split('{A名}').join(a.name)
                    .split('{B名}').join(b.name)
                    .split('{胜者}').join(charNameOf(record.winnerCharId))
                    .split('{A宠物}').join(petSheet(a))
                    .split('{B宠物}').join(petSheet(b))
                    .split('{脚本战报}').join(record.rounds.join('\n'))
                    .split('{败者主人}').join(charNameOf(loser.charId))
                    .split('{胜者主人}').join(charNameOf(winner.charId))
                    .split('{败者角色}').join(loser.charName)
                    .split('{胜者角色}').join(winner.charName);
                const data = await safeFetchJson(
                    `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                        body: JSON.stringify({
                            model: cfg.model,
                            messages: [
                                { role: 'system', content: prompt },
                                { role: 'user', content: '请开始播报。' },
                            ],
                            temperature: 0.9, max_tokens: 2048, stream: false,
                        }),
                    },
                    1, 120_000, { appName: '宠物对战', purpose: '战后评价' },
                );
                const d2 = await data;
                const text = extractContent(d2);
                if (text) {
                    record.narration = text;
                    record.promptSent = prompt;
                    await DB.savePetBattle(record);
                    setArena(cur => (cur && cur.record.id === record.id ? { ...cur, record: { ...record } } : cur));
                }
            } catch { /* 播报失败 → 脚本战报兜底 */ }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [arena, arenaPhase, eventIdx]);

    // ─── 宠物形象渲染（多行点阵按容器缩放字号，等宽不歪）───
    const PetVisual: React.FC<{ pet: { imageRef?: string; kaomoji?: string; name: string }, size?: string, boxPx?: number }> = ({ pet, size = 'w-14 h-14', boxPx = 56 }) => {
        if (pet.imageRef) return <TokenImg value={pet.imageRef} className={`${size} rounded-xl object-cover border border-white/10`} />;
        const dot = pet.kaomoji || '';
        if (dot.includes('\n')) {
            const m = dotMeasure(dot);
            return (
                <div className={`${size} rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden`}>
                    <pre className="font-mono whitespace-pre text-center text-slate-600" style={{ fontSize: dotFontPx(m.lines, m.cols, boxPx, boxPx), lineHeight: 1.15 }}>{dot}</pre>
                </div>
            );
        }
        return (
            <div className={`${size} rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden`}>
                <span className="text-[9px] font-mono whitespace-pre text-center leading-tight text-slate-600">{pet.kaomoji || '(=ↀωↀ=)'}</span>
            </div>
        );
    };

    // ─── 战斗页面（两阶段：intro 匹配对峙 → battle 战况推进）───
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
        // 每个宠物一格：HP 条（与卡片同宽）+ 竖版卡片，同行一人一边
        const sideColumn = (c: PetCombatant, side: 'a' | 'b', isAttacking: boolean, isHurt: boolean) => {
            const pct = Math.max(0, Math.round((ev.hpA !== undefined && side === 'a' ? ev.hpA : ev.hpB) / Math.max(c.maxHp, 1) * 100));
            const hpNow = side === 'a' ? ev.hpA : ev.hpB;
            return (
                <div className="flex-1 min-w-0 space-y-1.5">
                    {/* HP 条：与卡片同宽 */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black text-slate-600 tabular-nums">{hpNow}</span>
                        <div className="flex-1 h-3.5 bg-slate-300/70 rounded-full overflow-hidden border border-[#7d7264]/30">
                            <div className={`h-full rounded-full transition-all duration-500 ${pct > 50 ? 'bg-emerald-400' : pct > 20 ? 'bg-amber-400' : 'bg-rose-400'}`}
                                style={{ width: `${pct}%`, marginLeft: side === 'b' ? 'auto' : undefined }} />
                        </div>
                    </div>
                    {/* 竖版宠物卡 */}
                    <div className={`rounded-2xl border-2 overflow-hidden transition-all duration-300 ${
                        isHurt ? 'border-rose-400 bg-rose-50'
                            : isAttacking ? 'border-amber-400 bg-amber-50 scale-[1.02] shadow-lg shadow-amber-100'
                            : 'border-[#7d7264]/30 bg-[#f6f3ec]'
                    }`}>
                        <div className="px-2 pt-2 pb-1 text-center">
                            <div className="text-[11px] font-bold text-slate-600 truncate">{c.charName}</div>
                        </div>
                    <div className="flex items-center justify-center py-1 px-2 min-h-[110px]">
                        {c.imageRef
                            ? <TokenImg value={c.imageRef} className="w-full h-32 object-cover rounded-lg" />
                            : (c.kaomoji || '').includes('\n')
                                ? (() => { const m = dotMeasure(c.kaomoji!); return <pre className="font-mono whitespace-pre text-center text-slate-600" style={{ fontSize: dotFontPx(m.lines, m.cols, 150, 110), lineHeight: 1.15 }}>{c.kaomoji}</pre>; })()
                                : <span className="text-[10px] font-mono whitespace-pre text-center leading-tight text-slate-600 break-all">{c.kaomoji || '(=ↀωↀ=)'}</span>}
                    </div>
                        <div className="px-2 pb-2 text-center">
                            <div className="text-xs font-bold text-slate-700 truncate">{c.name}</div>
                            <span className={`inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${GRADE_COLORS[c.grade]}`}>{c.grade} 级 · 攻 {c.atk}</span>
                        </div>
                    </div>
                </div>
            );
        };
        return (
            <div className="space-y-3">
                {/* 顶行：一人一边，HP 条与卡片同宽 */}
                <div className="flex items-start gap-2">
                    {sideColumn(arena.a, 'a', aAttacking, aHurt)}
                    <div className="flex flex-col items-center justify-center px-0.5 pt-8">
                        <span className={`font-black text-slate-300 transition-all duration-700 ${intro ? 'text-2xl text-rose-400 scale-125' : 'text-sm'}`}>VS</span>
                    </div>
                    {sideColumn(arena.b, 'b', bAttacking, bHurt)}
                </div>
                {/* 下方：战况日志面板（intro 隐藏 → battle 滑入展开） */}
                <div className={`overflow-hidden transition-all duration-700 ease-out ${intro ? 'max-h-0 opacity-0 translate-y-6' : 'max-h-[420px] opacity-100 translate-y-0'}`}>
                    <div className="rounded-2xl border border-[#7d7264]/30 bg-[#4a4438] p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#c9bfae] mb-2 flex items-center justify-between">
                            <span>⚔ 战况</span>
                            {!done && <span className="animate-pulse"> LIVE</span>}
                        </div>
                        <div ref={logRef} className="space-y-1.5 max-h-44 overflow-y-auto">
                            {(() => {
                                const shown = arena.events.slice(0, eventIdx + 1).filter(e => e.kind !== 'chain').length;
                                const visible = arena.record.rounds.slice(0, Math.max(1, shown));
                                return visible.map((r, i, arr) => {
                                    const m = r.match(/^(第\d+回合：)?(.*)$/);
                                    return (
                                        <div key={i} className={`text-center leading-relaxed font-mono ${i === arr.length - 1 ? 'text-amber-200 font-bold' : 'text-[#d8d0c2]'}`}>
                                            {m && m[1] ? <span className="text-[9px] opacity-60 mr-1.5">{m[1]}</span> : null}
                                            <span className="text-xs">{m ? m[2] : r}</span>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                        {!intro && ev.kind === 'crit' && <div className="text-center text-base font-black text-rose-300 animate-fade-in">暴击！-{ev.dmg}</div>}
                        {!intro && ev.kind === 'dodge' && <div className="text-center text-sm font-bold text-sky-300 animate-fade-in">闪避！</div>}
                    </div>
                </div>
                {/* 战后 AI 播报（败方评价 + 胜方回复） */}
                {done && arena.record.narration && (
                    <div className="rounded-2xl border border-[#7d7264]/30 bg-[#4a4438] p-3 space-y-2">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#c9bfae]">战后感言</div>
                        {arena.record.narration.split('\n').map((line, i) => (line.trim() ? (
                            <div key={i} className="text-xs leading-relaxed text-[#e8e0d0]">{line}</div>
                        ) : null))}
                    </div>
                )}
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
            {/* 抽卡动画弹窗：点抽签立即出现（不等 API），点背景可跳过 → 结果卡另开一张 */}
            {animScene && (
                <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-6" onClick={() => { setAnimScene(null); setResultModal(cur => cur ?? { pet: animScene.pet }); }}>
                    <div className="bg-white rounded-2xl w-full max-w-sm p-5 relative animate-fade-in" onClick={e => e.stopPropagation()}>
                        {/* 动画区：图片模式（URL，支持 GIF）或盲文多帧轮换（默认三帧数码猫/自定义空行分隔多帧） */}
                        <div className="rounded-xl bg-[#f6f3ec] border border-[#7d7264]/30 flex items-center justify-center h-56 overflow-hidden">
                            {meta.drawAnimMode === 'image' && meta.drawAnimUrl
                                ? <img src={meta.drawAnimUrl} className="max-h-full max-w-full object-contain" />
                                : (() => { const frames = parseAnimFrames(meta.drawAnimBraille); const m = dotMeasure(frames[0]); return <pre className="font-mono whitespace-pre text-center text-slate-600" style={{ fontSize: dotFontPx(m.lines, m.cols, 320, 210), lineHeight: 1.15, animation: 'petBob 900ms ease-in-out infinite alternate' }}>{frames[digFrame % frames.length]}</pre>; })()}
                        </div>
                        <div className="text-center text-[11px] text-slate-500 tracking-[0.3em] mt-3 animate-pulse">翻 找 中 …</div>
                    </div>
                </div>
            )}

            {/* 抽卡结果卡弹窗（动画消失后出现）：点阵大图 + 介绍 + 评价 */}
            {resultModal && resultModal.pet && (
                <div className="fixed inset-0 z-[210] bg-black/50 flex items-center justify-center p-6" onClick={() => setResultModal(null)}>
                    <div className="bg-white rounded-2xl w-full max-w-sm p-5 relative animate-fade-in" onClick={e => e.stopPropagation()}>
                        {(() => {
                            const pet = resultModal.pet;
                            const dot = pet.kaomoji || '';
                            if (pet.imageRef) return (
                                <div className="rounded-xl bg-[#f6f3ec] border border-[#7d7264]/30 flex items-center justify-center h-56 overflow-hidden mb-3">
                                    <TokenImg value={pet.imageRef} className="max-h-full max-w-full object-contain" />
                                </div>
                            );
                            if (dot.includes('\n')) {
                                const m = dotMeasure(dot);
                                return (
                                    <div className="rounded-xl bg-[#f6f3ec] border border-[#7d7264]/30 flex items-center justify-center h-56 overflow-hidden mb-3">
                                        <pre className="font-mono whitespace-pre text-center text-slate-700" style={{ fontSize: dotFontPx(m.lines, m.cols, 320, 210), lineHeight: 1.15 }}>{dot}</pre>
                                    </div>
                                );
                            }
                            return null;
                        })()}
                        <div className="flex items-center gap-3">
                            {!(resultModal.pet.imageRef || (resultModal.pet.kaomoji || '').includes('\n')) && <PetVisual pet={resultModal.pet} size="w-16 h-16" />}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800">{resultModal.pet.name}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${GRADE_COLORS[resultModal.pet.grade]}`}>{resultModal.pet.grade} 级 · 攻击 {resultModal.pet.atk}</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1">{resultModal.pet.desc || '…'}</p>
                                {resultModal.pet.evalText && <p className="text-[11px] text-slate-600 mt-1.5 italic">「{resultModal.pet.evalText}」</p>}
                            </div>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5 mt-3 text-center">
                            {[['❤', resultModal.pet.hp], ['⚔', resultModal.pet.atk], ['💨', resultModal.pet.stats.spd], ['🌀', resultModal.pet.stats.dodge], ['💥', resultModal.pet.stats.crit]].map(([label, v]) => (
                                <div key={label as string} className="bg-slate-50 rounded-lg py-2">
                                    <div className="text-[10px] text-slate-400">{label}</div>
                                    <div className="text-sm font-bold text-slate-700">{v}</div>
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-slate-400 mt-2 text-center">归属：{charNameOf(resultModal.pet.ownerId)} · {resultModal.pet.source === 'pool' ? '宠物池命中' : '随机生成'}</p>
                        <button onClick={() => setResultModal(null)}
                            className="w-full mt-3 py-2.5 rounded-xl bg-fuchsia-500 text-white text-sm font-bold active:scale-[0.98]">确定</button>
                    </div>
                </div>
            )}

            {/* 顶栏 */}
            <div className="shrink-0 z-10 sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-200/60" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="pt-12 pb-3 px-4 flex items-center justify-between">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">←</button>
                    <span className="font-bold text-slate-700">🐾 宠物对战</span>
                    <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">🪙 {goldOf('user')}</span>
                </div>
                {/* Tabs */}
                <div className="flex gap-1 px-4 pb-2">
                    {([['gacha', '抽奖'], ['pets', '宠物列表'], ['battle', '对战'], ['stats', '战绩']] as Array<[Tab, string]>).map(([id, label]) => (
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
                        {/* 池子模板管理（折叠） */}
                        <details className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
                            <summary className="px-4 py-3 text-xs font-bold text-slate-600 cursor-pointer">🐾 宠物池模板管理（名字+形象+权重，不绑定角色）</summary>
                            <div className="p-4 pt-0 space-y-3">
                                <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="宠物名字" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none" />
                                <textarea value={tplKaomoji} onChange={e => setTplKaomoji(e.target.value)} placeholder={`颜文字 / 点阵图（不传图片时显示，点阵标准：最多 ${DOT_MAX_LINES} 行 × ${DOT_MAX_COLS} 字/行）`} rows={3}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-mono outline-none whitespace-pre" />
                                {tplKaomoji.trim() && (() => { const m = dotMeasure(tplKaomoji); const over = m.lines > DOT_MAX_LINES || m.cols > DOT_MAX_COLS; return (
                                    <p className={`text-[9px] ${over ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>{m.lines} 行 / 最宽 {m.cols} 字（标准 {DOT_MAX_LINES} 行 × {DOT_MAX_COLS} 字）{over ? ' — 超了，入池会被拦截' : ''}</p>
                                ); })()}
                                <div className="flex items-center gap-2">
                                    <button onClick={() => tplFileRef.current?.click()} className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-600">插入图片</button>
                                    {tplImageRef && <TokenImg value={tplImageRef} className="w-9 h-9 rounded-lg object-cover" />}
                                    <input type="file" ref={tplFileRef} className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) handleTplImage(f); e.target.value = ''; }} />
                                    <div className="flex items-center gap-1 ml-auto">
                                        <span className="text-[10px] text-slate-400">权重</span>
                                        <input type="number" min={1} value={tplWeight} onChange={e => setTplWeight(parseInt(e.target.value) || 1)} className="w-16 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none" />
                                    </div>
                                </div>
                                <button onClick={handleAddTemplate} className="w-full py-2.5 rounded-xl bg-fuchsia-500 text-white text-sm font-bold active:scale-[0.98]">加入池子</button>
                                {templates.length > 0 && (
                                    <div className="space-y-2 pt-2 border-t border-slate-100">
                                        {templates.map(t => (
                                            <div key={t.id} className="flex items-center gap-2">
                                                <PetVisual pet={t} size="w-9 h-9" boxPx={36} />
                                                <span className="flex-1 text-xs font-bold text-slate-600 truncate">{t.name}</span>
                                                <span className="text-[9px] text-slate-400">权重 {t.weight}</span>
                                                <button onClick={() => handleDeleteTemplate(t.id)} className="text-slate-300 hover:text-red-400 px-1">×</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-[9px] text-slate-400">池子概率制永不抽空：命中模板 = 以它的名字形象出新宠物（属性照常重掷）；未命中 = 词库随机生成。</p>
                            </div>
                        </details>
                        <div className="bg-white rounded-2xl p-4 border border-slate-200/70">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">谁去抽奖（你也能抽）</label>
                            <select value={gachaCharId} onChange={e => setGachaCharId(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none">
                                {participants.map(p => {
                                    const owned = aliveByChar(p.id).length > 0;
                                    return <option key={p.id} value={p.id}>{p.name}{owned ? `（默认出战：${defaultPetOf(p.id)?.name || '无'}）` : ''}</option>;
                                })}
                            </select>
                            <button onClick={doGacha} disabled={drawing}
                                className={`w-full mt-3 py-3 rounded-2xl font-bold text-white transition-all ${drawing ? 'bg-slate-300' : 'bg-gradient-to-r from-fuchsia-500 to-purple-500 active:scale-[0.98]'}`}>
                                🎰 点抽签（{GACHA_COST} 金币 · {charNameOf(gachaCharId)} 有 🪙 {goldOf(gachaCharId)}）
                            </button>
                            <p className="text-[9px] text-slate-400 mt-2">品级：A(6%) B(12%) C(22%) D(30%) E(30%)；角色抽卡会调一次 AI 用角色口吻评价这次抽奖；宠物死亡后可重新抽奖。</p>
                        </div>
                        {lastRolled && (
                            <div className="bg-white rounded-2xl p-4 border border-slate-200/70 animate-fade-in">
                                <div className="flex items-center gap-3">
                                    <PetVisual pet={lastRolled} size="w-16 h-16" />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800">{lastRolled.name}</span>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${GRADE_COLORS[lastRolled.grade]}`}>{lastRolled.grade} 级 · 攻击 {lastRolled.atk}</span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-1">{lastRolled.desc || '…'}</p>
                                        {lastEval && <p className="text-[11px] text-slate-600 mt-1.5 italic">「{lastEval}」</p>}
                                    </div>
                                </div>
                                <div className="grid grid-cols-5 gap-1.5 mt-3 text-center">
                                    {[['❤ 血量', lastRolled.hp], ['⚔ 攻击', lastRolled.atk], ['💨 敏捷', lastRolled.stats.spd], ['🌀 闪避', lastRolled.stats.dodge], ['💥 暴击', lastRolled.stats.crit]].map(([label, v]) => (
                                        <div key={label as string} className="bg-slate-50 rounded-lg py-2">
                                            <div className="text-[9px] text-slate-400">{label}</div>
                                            <div className="text-sm font-bold text-slate-700">{v}</div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[9px] text-slate-400 mt-2">归属：{charNameOf(lastRolled.ownerId)} · 来源：{lastRolled.source === 'pool' ? '宠物池命中' : '随机生成'}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── 宠物列表（通讯录式：点开看所有宠物）─── */}
                {tab === 'pets' && (
                    <div className="space-y-4">
                        {(() => {
                            const rows = participants.map(p => ({
                                ...p,
                                petCount: aliveByChar(p.id).length,
                                gold: goldOf(p.id),
                            }));
                            return rows.map(row => (
                                <details key={row.id} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
                                    <summary className="flex items-center gap-3 p-3 cursor-pointer">
                                        <TokenImg value={row.avatar} className="w-10 h-10 rounded-full object-cover" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-slate-700 truncate">{row.name}</div>
                                            <div className="text-[10px] text-slate-400">{row.petCount} 只宠物 · 🪙 {row.gold}</div>
                                        </div>
                                        <span className="text-slate-300">▸</span>
                                    </summary>
                                    <div className="px-3 pb-3 space-y-2">
                                        {aliveByChar(row.id).length === 0 && <div className="text-[11px] text-slate-400 py-2">还没有宠物，去抽奖吧</div>}
                                        {aliveByChar(row.id).slice().sort((a, b) => a.createdAt - b.createdAt).map(pet => {
                                            const isDefault = defaultPetOf(row.id)?.id === pet.id;
                                            return (
                                                <div key={pet.id} className={`bg-slate-50 rounded-xl p-2.5 flex items-center gap-2.5 ${isDefault ? 'ring-1 ring-fuchsia-300' : ''}`}>
                                                    <PetVisual pet={pet} size="w-10 h-10" boxPx={40} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-bold text-slate-700 truncate">
                                                            {pet.name}
                                                            <span className={`ml-1 text-[9px] font-bold px-1 py-0.5 rounded border ${GRADE_COLORS[pet.grade]}`}>{pet.grade}</span>
                                                            {isDefault && <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-fuchsia-500 text-white">默认出战</span>}
                                                        </div>
                                                        <div className="text-[9px] text-slate-400">❤{pet.hp} ⚔{pet.atk} 💨{pet.stats.spd} 🌀{pet.stats.dodge} 💥{pet.stats.crit}</div>
                                                    </div>
                                                    {!isDefault && (
                                                        <button onClick={async () => { await setDefaultPet(row.id, pet.id); addToast(`${row.name} 的默认出战改为「${pet.name}」`, 'success'); }}
                                                            className="shrink-0 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-bold text-slate-500 active:scale-95">设为默认</button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        <p className="text-[9px] text-slate-400 px-1">对战用的是「默认出战」那只；它阵亡后会按抽取顺序自动换下一只。</p>
                                    </div>
                                </details>
                            ));
                        })()}
                        {/* 设置：金币调整 + 抽卡动画 + 提示词模板 */}
                        <details className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
                            <summary className="px-4 py-3 text-xs font-bold text-slate-600 cursor-pointer">⚙ 设置（金币 / 抽卡动画 / 提示词模板）</summary>
                            <div className="px-4 pb-4 space-y-4">
                                {/* 金币调整 */}
                                <div className="pt-2 border-t border-slate-100">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">调整每人的金币</label>
                                    <div className="space-y-2">
                                        {participants.map(p => (
                                            <div key={p.id} className="flex items-center gap-2">
                                                <TokenImg value={p.avatar} className="w-7 h-7 rounded-full object-cover" />
                                                <span className="text-xs font-bold text-slate-600 flex-1 truncate">{p.name}</span>
                                                <span className="text-xs font-bold text-amber-600 tabular-nums">🪙 {goldOf(p.id)}</span>
                                                <input type="number" onKeyDown={e => {
                                                    if (e.key !== 'Enter') return;
                                                    const v = parseInt((e.target as HTMLInputElement).value);
                                                    if (!isNaN(v)) { setGoldOf(p.id, Math.max(0, goldOf(p.id) + v)); (e.target as HTMLInputElement).value = ''; addToast(`${p.name} 金币 ${v >= 0 ? '+' : ''}${v}`, 'success'); }
                                                }} placeholder="±增减" className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none" />
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-1">输入正负数回车 = 增减金币。</p>
                                </div>
                                {/* 抽卡动画 */}
                                <div className="pt-2 border-t border-slate-100">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">抽卡动画</label>
                                    <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-2">
                                        {([['braille', '盲文点阵'], ['image', '图片 GIF']] as Array<['braille' | 'image', string]>).map(([id, label]) => (
                                            <button key={id} onClick={async () => { const next = { ...meta, drawAnimMode: id }; setMeta(next); await DB.savePetMeta(next); }}
                                                className={`flex-1 py-1.5 rounded text-[10px] font-bold ${meta.drawAnimMode === id ? 'bg-white shadow text-slate-700' : 'text-slate-400'}`}>{label}</button>
                                        ))}
                                    </div>
                                    {meta.drawAnimMode === 'image' && (
                                        <input value={meta.drawAnimUrl || ''} onChange={async e => { const next = { ...meta, drawAnimUrl: e.target.value.trim() || undefined }; setMeta(next); await DB.savePetMeta(next); }} placeholder="图片 URL（支持 GIF）" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none" />
                                    )}
                                    {meta.drawAnimMode === 'braille' && (() => {
                                        const frames = parseAnimFrames(meta.drawAnimBraille);
                                        return (
                                            <div className="space-y-2">
                                                <textarea value={meta.drawAnimBraille || ''} onChange={async e => { const next = { ...meta, drawAnimBraille: e.target.value || undefined }; setMeta(next); await DB.savePetMeta(next); }} placeholder={`自定义盲文（留空 = 默认数码猫；多帧用空行分隔，就会逐帧轮换；每帧建议 ≤ ${DOT_MAX_LINES} 行 × ${DOT_MAX_COLS} 字）`} rows={4}
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-mono outline-none whitespace-pre" />
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-slate-400">识别到 <b className="text-slate-600">{frames.length}</b> 帧（空行分隔）</span>
                                                    <span className="text-[10px] text-slate-400 ml-auto">每帧</span>
                                                    <input type="number" min={60} step={20} value={meta.drawAnimInterval || DIG_INTERVAL_DEFAULT}
                                                        onChange={async e => { const v = Math.max(60, parseInt(e.target.value) || DIG_INTERVAL_DEFAULT); const next = { ...meta, drawAnimInterval: v }; setMeta(next); await DB.savePetMeta(next); }}
                                                        className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none tabular-nums" />
                                                    <span className="text-[10px] text-slate-400">毫秒</span>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                                {/* 提示词模板 */}
                                <div className="pt-2 border-t border-slate-100">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">提示词模板（可视化编辑）</label>
                                    <p className="text-[9px] text-slate-400 mb-2 leading-tight">占位符调用时自动替换：抽卡 = {'{人设}{名字}{品级}{攻击}{敏捷}{闪避}{暴击}{血量}'}；战报 = {'{A人设}{B人设}{A主人}{B主人}{A名}{B名}{A宠物}{B宠物}{脚本战报}{胜者}{败者}'} 等。</p>
                                    <div className="text-[10px] font-bold text-slate-500 mb-1">抽卡评价模板</div>
                                    <textarea value={meta.promptGacha || PROMPT_GACHA_DEFAULT} onChange={async e => { const next = { ...meta, promptGacha: e.target.value }; setMeta(next); await DB.savePetMeta(next); }} rows={6}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-mono outline-none mb-1" />
                                    <button onClick={async () => { const next = { ...meta, promptGacha: undefined }; setMeta(next); await DB.savePetMeta(next); addToast('已恢复默认抽卡评价模板', 'success'); }} className="text-[9px] text-violet-500 mb-3">↺ 恢复默认抽卡模板</button>
                                    <div className="text-[10px] font-bold text-slate-500 mb-1">战报播报模板</div>
                                    <textarea value={meta.promptBattle || PROMPT_BATTLE_DEFAULT} onChange={async e => { const next = { ...meta, promptBattle: e.target.value }; setMeta(next); await DB.savePetMeta(next); }} rows={8}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-mono outline-none mb-1" />
                                    <button onClick={async () => { const next = { ...meta, promptBattle: undefined }; setMeta(next); await DB.savePetMeta(next); addToast('已恢复默认战报模板', 'success'); }} className="text-[9px] text-violet-500">↺ 恢复默认战报模板</button>
                                </div>
                                {/* 模型选择 */}
                                <div className="pt-2 border-t border-slate-100">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">AI 模型（抽卡评价 / 战报播报）</label>
                                    <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                                        {([['sub', '副API（便宜）'], ['main', '主聊天模型']] as Array<['sub' | 'main', string]>).map(([id, label]) => (
                                            <button key={id} onClick={async () => { const next = { ...meta, modelMode: id }; setMeta(next); await DB.savePetMeta(next); }}
                                                className={`flex-1 py-1.5 rounded text-[10px] font-bold ${meta.modelMode === id ? 'bg-white shadow text-slate-700' : 'text-slate-400'}`}>{label}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </details>
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
                                    {participants.filter(p => aliveByChar(p.id).length > 0).map(p => <option key={p.id} value={p.id}>{p.name}（{defaultPetOf(p.id)?.name || '无'}）</option>)}
                                </select>
                            </div>
                            {mode === 'avb' && (
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">B 方角色</label>
                                    <select value={sideBChar} onChange={e => setSideBChar(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none">
                                        <option value="">选择对手…</option>
                                        {participants.filter(p => p.id !== sideAChar && aliveByChar(p.id).length > 0).map(p => <option key={p.id} value={p.id}>{p.name}（{defaultPetOf(p.id)?.name || '无'}）</option>)}
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
                            return (
                                <>
                                    {rows.length === 0 && <div className="text-center py-16 text-sm text-slate-400">还没有对战记录，去打一场吧</div>}
                                    {rows.map(([charId, s]) => (
                                        <div key={charId} className="bg-white rounded-2xl p-4 border border-slate-200/70 flex items-center gap-3">
                                            <TokenImg value={charAvatarOf(charId)} className="w-10 h-10 rounded-full object-cover" />
                                            <div className="flex-1">
                                                <div className="text-sm font-bold text-slate-700">{charNameOf(charId)}</div>
                                                <div className="text-[10px] text-slate-400">总场次 {s.win + s.lose}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-emerald-500 font-bold text-sm">{s.win} 胜</div>
                                                <div className="text-rose-400 font-bold text-sm">{s.lose} 负</div>
                                            </div>
                                        </div>
                                    ))}
                                    {battles.length > 0 && (
                                        <button onClick={async () => { for (const b of battles) await DB.deletePetBattle(b.id); setBattles([]); addToast('已清空全部战报与战绩', 'success'); }}
                                            className="w-full py-2.5 rounded-xl border border-rose-200 text-rose-500 text-xs font-bold">🗑 清空全部战报 / 战绩</button>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PetPvpApp;
