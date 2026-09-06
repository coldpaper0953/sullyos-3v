/**
 * 宠物对战引擎（纯函数，无 React / 无 AI 调用）。
 *
 * 设计原则：脚本先算完全部结果——品级/数值/战斗流水都是 Math.random 决定的，
 * AI 只负责把脚本战报流水写成有角色口吻的播报（调用方组织 prompt）。
 *
 * 公式（与用户对齐的机制）：
 *   品级攻击加成：A+20 / B+15 / C+10 / D+5 / E+0
 *   攻速/闪避/暴击：随机分配，总和 = totalStatPoints（默认 30，可调）
 *   血量：200 + 品级加成 + rand(0~80)，硬上限 300
 *   命中判定：闪避% 完全闪避；暴击% ×1.5；伤害 = 攻击 × (0.85~1.15)
 *   回合：攻速高者先手；每次攻击后攻击方有 攻速% 概率保留回合继续攻击
 *         （否则轮到对方），每次保留回合最多连击 4 次防死循环
 *   终局：血量归零，或 maxRounds（默认 30）回合后按剩余血量比例判胜
 */

import { Pet, PetGrade, PetStats } from '../types';

/** 品级 → 数值区间：攻击总区间 0~150，血量总区间 0~300，按品级分段随机 */
export const GRADE_RANGES: Record<PetGrade, { atk: [number, number]; hp: [number, number] }> = {
    A: { atk: [120, 150], hp: [225, 300] },
    B: { atk: [90, 120], hp: [170, 250] },
    C: { atk: [60, 90], hp: [110, 180] },
    D: { atk: [30, 60], hp: [60, 120] },
    E: { atk: [0, 30], hp: [20, 70] },
};
/** 品级权重（A 最稀有）。总和 100，随机数落区间判定。 */
export const GRADE_WEIGHTS: Array<{ grade: PetGrade; w: number }> = [
    { grade: 'A', w: 6 }, { grade: 'B', w: 12 }, { grade: 'C', w: 22 }, { grade: 'D', w: 30 }, { grade: 'E', w: 30 },
];

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

export interface PetCombatant {
    charId: string;
    charName: string;
    petId?: string;
    name: string;
    grade: PetGrade;
    atk: number;        // 攻击：品级区间随机值（0~150）
    spd: number;
    dodge: number;
    crit: number;
    hp: number;
    maxHp: number;
    imageRef?: string;
    kaomoji?: string;
    desc?: string;
}

// ─── 抽奖 ───

export function rollGrade(): PetGrade {
    const total = GRADE_WEIGHTS.reduce((s, g) => s + g.w, 0);
    let r = Math.random() * total;
    for (const g of GRADE_WEIGHTS) {
        if (r < g.w) return g.grade;
        r -= g.w;
    }
    return 'E';
}

/** 敏捷/闪避/暴击 三项随机分配，总和 = totalStatPoints（切两刀均匀随机） */
export function rollStats(totalStatPoints: number): PetStats {
    const cut1 = Math.random() * totalStatPoints;
    const cut2 = Math.random() * totalStatPoints;
    const lo = Math.min(cut1, cut2);
    const hi = Math.max(cut1, cut2);
    const spd = Math.max(0, Math.round(hi - lo));
    const dodge = Math.max(0, Math.round(lo));
    const crit = Math.max(0, Math.round(totalStatPoints - hi));
    return { spd, dodge, crit };
}

/** 攻击：按品级区间随机（总区间 0~150） */
export function rollAtk(grade: PetGrade): number {
    const [lo, hi] = GRADE_RANGES[grade].atk;
    return randInt(lo, hi);
}

/** 血量：按品级区间随机（总区间 0~300） */
export function rollHpByGrade(grade: PetGrade): number {
    const [lo, hi] = GRADE_RANGES[grade].hp;
    return randInt(lo, hi);
}

/** 池子判定：按权重抽一个模板；未命中（随机生成线）返回 null。missWeight 是"池子全空"的虚拟权重。 */
export function rollPool<T extends { id: string; weight?: number }>(
    templates: T[],
    missWeight: number = 100,
): T | null {
    const valid = templates.filter(t => (t.weight || 0) > 0);
    if (valid.length === 0) return null;
    const total = valid.reduce((s, t) => s + (t.weight || 0), 0) + missWeight;
    let r = Math.random() * total;
    for (const t of valid) {
        r -= t.weight || 0;
        if (r < 0) return t;
    }
    return null; // 未命中池子 → 随机生成
}

// ─── 战斗 ───

export function buildCombatant(
    pet: Pet,
    charId: string,
    charName: string,
    totalStatPoints: number,
): PetCombatant {
    return {
        charId, charName,
        petId: pet.id,
        name: pet.name,
        grade: pet.grade,
        atk: pet.atk ?? 30,
        spd: pet.stats.spd, dodge: pet.stats.dodge, crit: pet.stats.crit,
        hp: pet.hp, maxHp: pet.hp,
        imageRef: pet.imageRef,
        kaomoji: pet.kaomoji,
        desc: pet.desc,
    };
}

export interface BattleResult {
    rounds: string[];      // 脚本战报流水（文字版）
    events: BattleEvent[]; // 结构化事件流（战斗页面逐拍回放用）
    winner: 'a' | 'b';
    loser: 'a' | 'b';
}

export interface BattleEvent {
    kind: 'start' | 'attack' | 'crit' | 'dodge' | 'chain' | 'ko' | 'exhaust' | 'win';
    atkSide: 'a' | 'b';
    round: number;
    text: string;
    hpA: number;   // 事件发生后的双方血量（回放时直接刷 HP 条）
    hpB: number;
    dmg?: number;
}

/**
 * 回合制战斗模拟。sideA/sideB 为双方战斗体；totalStatPoints 用于文案说明。
 * 追击机制：每次攻击后攻击方有 spd% 概率保留回合继续攻击（单回合内最多连击 4 次）。
 */
export function simulateBattle(sideA: PetCombatant, sideB: PetCombatant, maxRounds = 30): BattleResult {
    const rounds: string[] = [];
    const events: BattleEvent[] = [];
    const pushEvent = (kind: BattleEvent['kind'], atkSide: 'a' | 'b', round: number, text: string, dmg?: number) => {
        events.push({ kind, atkSide, round, text, hpA: hpA, hpB: hpB, dmg });
    };
    let hpA = sideA.hp, hpB = sideB.hp;
    // 先手：攻速高者；相同则随机
    let attackerIsA = sideA.spd === sideB.spd ? Math.random() < 0.5 : sideA.spd > sideB.spd;
    const attacker = () => (attackerIsA ? sideA : sideB);
    const defender = () => (attackerIsA ? sideB : sideA);
    const hpOf = (isA: boolean) => (isA ? hpA : hpB);
    const deal = (isA: boolean, dmg: number) => { if (isA) hpB = Math.max(0, hpB - dmg); else hpA = Math.max(0, hpA - dmg); };

    const startText = `开局：${sideA.name}（HP ${sideA.hp}）vs ${sideB.name}（HP ${sideB.hp}），${attacker().name} 抢到先手。`;
    rounds.push(startText);
    pushEvent('start', attackerIsA ? 'a' : 'b', 0, startText);

    let round = 1;
    let ended = false;
    while (round <= maxRounds && !ended) {
        const atk = attacker();
        const def = defender();
        let chains = 0;
        // 本回合：攻击方一直打到「保留回合判定失败」或对方倒下（最多 4 次连击）
        for (;;) {
            if (def.hp <= 0 || hpOf(!attackerIsA) <= 0) { ended = true; break; }
            // 闪避判定
            if (Math.random() * 100 < def.dodge) {
                const t = `第${round}回合：${atk.name} 发起攻击，被 ${def.name} 闪避了！`;
                rounds.push(t);
                pushEvent('dodge', attackerIsA ? 'a' : 'b', round, t);
            } else {
                const isCrit = Math.random() * 100 < atk.crit;
                const dmg = Math.max(1, Math.round(atk.atk * (0.85 + Math.random() * 0.3) * (isCrit ? 1.5 : 1)));
                deal(attackerIsA, dmg);
                const t = `第${round}回合：${atk.name} 命中 ${def.name}，造成 ${dmg} 点伤害${isCrit ? '（暴击！）' : ''}。${def.name} 剩余 HP ${hpOf(!attackerIsA)}。`;
                rounds.push(t);
                pushEvent(isCrit ? 'crit' : 'attack', attackerIsA ? 'a' : 'b', round, t, dmg);
            }
            if (hpOf(!attackerIsA) <= 0) {
                const t = `${def.name} 倒下了！`;
                rounds.push(t);
                pushEvent('ko', attackerIsA ? 'a' : 'b', round, t);
                ended = true;
                break;
            }
            // 敏捷保留回合判定
            chains++;
            if (chains >= 4 || Math.random() * 100 >= atk.spd) break;
            const t = `${atk.name} 身形一闪，抢在 ${def.name} 反应之前再次出手！`;
            rounds.push(t);
            pushEvent('chain', attackerIsA ? 'a' : 'b', round, t);
        }
        if (ended) break;
        attackerIsA = !attackerIsA; // 轮到对方
        round++;
    }

    if (!ended) {
        // 回合耗尽：剩余血量比例定胜负
        const pctA = hpA / sideA.hp, pctB = hpB / sideB.hp;
        const t = `${maxRounds} 回合战罢，双方力竭——按剩余血量判定。`;
        rounds.push(t);
        pushEvent('exhaust', 'a', round, t);
        attackerIsA = pctA >= pctB;
    }
    const winner = attackerIsA ? 'a' : 'b';
    const winText = `胜负已分：${(winner === 'a' ? sideA : sideB).name} 获胜！`;
    rounds.push(winText);
    pushEvent('win', winner, round, winText);
    return { rounds, events, winner, loser: winner === 'a' ? 'b' : 'a' };
}

/** 押注赔率：模拟 sims 局算 A 方胜率，赔率 = 0.95 / 胜率（5% 抽水），下限 1.1 */
export function estimateOdds(a: PetCombatant, b: PetCombatant, sims = 200): { rateA: number; oddsA: number; oddsB: number } {
    let aWins = 0;
    for (let i = 0; i < sims; i++) {
        const r = simulateBattle(
            { ...a, hp: a.hp, maxHp: a.hp },
            { ...b, hp: b.hp, maxHp: b.hp },
            30,
        );
        if (r.winner === 'a') aWins++;
    }
    const rateA = aWins / sims;
    const oddsA = Math.max(1.1, Math.round((0.95 / Math.max(rateA, 0.05)) * 100) / 100);
    const oddsB = Math.max(1.1, Math.round((0.95 / Math.max(1 - rateA, 0.05)) * 100) / 100);
    return { rateA, oddsA, oddsB };
}
