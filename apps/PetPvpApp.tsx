import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Pet, PetGrade, PetStats, PetBattleRecord, PetMeta, CharacterProfile } from '../types';
import { safeFetchJson, extractContent } from '../utils/safeApi';
import { CHAT_GEN_EVENTS, announceChatGen } from '../utils/chatGenEvents';
import {
    rollGrade, rollStats, rollAtk, rollHpByGrade, rollPool,
    buildCombatant, simulateBattle, estimateOdds, simulateContinue, PetCombatant, BattleEvent,
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

// 宠物点阵标准：最多 42 行 × 每行 36 字（盲文等宽，超出会歪/截断）
const DOT_MAX_LINES = 42;
const DOT_MAX_COLS = 36;
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

// 败者转盘默认条目（可在设置里增删改内容/权重）
const WHEEL_ITEMS_DEFAULT: Array<{ id: string; text: string; weight: number }> = [
    { id: 'w1', text: '学三声猫叫', weight: 30 },
    { id: 'w2', text: '下一句消息必须带「喵」', weight: 25 },
    { id: 'w3', text: '自爆一件糗事', weight: 20 },
    { id: 'w4', text: '夸赢家三句不准重复', weight: 15 },
    { id: 'w5', text: 'Avatar 换成赢家指定图', weight: 10 },
];
const NARRATION_BANNER_DEFAULT = '败者食尘，愿赌服输....';

const PROMPT_PUNISH_DEFAULT = `{人设}

你刚刚在宠物对战中败给 {赢家}，转盘抽到了惩罚：「{惩罚}」。

请用你自己的口吻，对接受这个惩罚做出回应（一两句话，40 字以内），直接输出回应本身，不要输出其他内容。`;

const PROMPT_RVR_TALK_DEFAULT = `{人设}

刚刚你和 {对方主人} 打了一场宠物对战：{结果}（对方出场：{对方主人} 的「{对方宠物}」）。

请用你自己的口吻发一条消息（一两句，40 字以内）：可以吐槽 {对方主人}、炫耀、或者帮用户带个话，直接输出消息本身，不要输出其他内容。`;

// 赌钱模式压金提示词：开局注入给双方「谁押了谁多少金币」，让角色带着赌注意识打完这场
const PROMPT_BET_STAKE_DEFAULT = `{A人设}

{B人设}

{A主人} 押 {B主人} {金额} 金币打这一场宠物对战（压金已扣，「{A宠物}」 vs 「{B宠物}」）。

请用各自口吻对这场赌局说一两句话（各 40 字以内，格式：{A主人}：…；{B主人}：…），直接输出，不要输出其他内容。`;
// 自定义盲文切帧：空行分隔多帧，无有效帧时回落默认三帧猫
const parseAnimFrames = (raw?: string): string[] => {
    if (!raw || !raw.trim()) return DIG_FRAMES;
    const frames = raw.replace(/\r/g, '').split(/\n\s*\n/).map(f => f.replace(/^\n+|\n+$/g, '')).filter(f => f.trim());
    return frames.length ? frames : DIG_FRAMES;
};

// 品级徽章统一中性色（卡片不再按品级分色；转盘彩色扇面不受影响）
const GRADE_COLORS: Record<PetGrade, string> = {
    A: 'text-[#3a3a36] border-[#AFA3A1] bg-[#DAD8C0]',
    B: 'text-[#3a3a36] border-[#AFA3A1]/70 bg-[#E9E8DB]',
    C: 'text-[#3a3a36] border-[#AFA3A1]/60 bg-[#E9E8DB]',
    D: 'text-[#4a4840] border-[#AFA3A1]/50 bg-[#F9FBF5]',
    E: 'text-[#4a4840] border-[#AFA3A1]/40 bg-[#F9FBF5]',
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

// ─── 内联 SVG 图标（替代 emoji，统一线条风格）───
type IconProps = { className?: string };
const IcoPaw: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <ellipse cx="7" cy="8.5" rx="2.6" ry="3.4" /><ellipse cx="17" cy="8.5" rx="2.6" ry="3.4" />
        <ellipse cx="12" cy="5.6" rx="2.5" ry="3.2" /><ellipse cx="3.4" cy="13.5" rx="2.1" ry="2.8" /><ellipse cx="20.6" cy="13.5" rx="2.1" ry="2.8" />
        <path d="M12 11c-4.5 0-8 3.6-8 6.6 0 1.9 1.5 3.4 3.4 3.4 1.5 0 2.9-.7 4.6-.7s3.1.7 4.6.7c1.9 0 3.4-1.5 3.4-3.4 0-3-3.5-6.6-8-6.6z" />
    </svg>
);
const IcoCoin: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
        <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M9.5 10.5h5M9.5 13.5h5" strokeLinecap="round" />
    </svg>
);
const IcoDice: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
        <rect x="4" y="4" width="16" height="16" rx="3.5" />
        <circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="9" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="15" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
);
const IcoSwords: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M4 4l7.5 7.5M20 4l-7.5 7.5M4 20l4-4M20 20l-4-4M6.5 17.5l-2-2M17.5 6.5l2 2M6.5 6.5l-2 2M17.5 17.5l2-2" />
        <path d="M9 15l-3.5 3.5M15 9l3.5-3.5" />
    </svg>
);
const IcoTarget: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
        <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
);
const IcoTrophy: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M8 4h8v6a4 4 0 01-8 0V4z" /><path d="M8 5H5.5A1.5 1.5 0 004 6.5c0 2.2 1.6 3.5 4 3.5M16 5h2.5A1.5 1.5 0 0120 6.5c0 2.2-1.6 3.5-4 3.5" />
        <path d="M12 14v3M8.5 20h7M10 17h4l1 3h-6l1-3z" />
    </svg>
);
const IcoHeart: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M12 20.5S3.5 15 3.5 9.3C3.5 6.4 5.7 4.5 8 4.5c1.7 0 3.1.9 4 2.2.9-1.3 2.3-2.2 4-2.2 2.3 0 4.5 1.9 4.5 4.8C20.5 15 12 20.5 12 20.5z" />
    </svg>
);
const IcoWind: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
        <path d="M3 8h9.5a2.5 2.5 0 100-2.5M3 12h14a2.5 2.5 0 110 5M3 16h6" />
    </svg>
);
const IcoDodge: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
        <path d="M20 8c-8-3-14 0-16 5M16 13l4-5-6-1.5" />
    </svg>
);
const IcoBoom: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M12 2.5l1.8 4.4 4.4-1.6-1.4 4.5 4.7 1.1-4 2.5 2.7 3.9-4.8-.4.3 4.8-4-2.7-2.6 4-1.4-4.6-4.6 1.5 1.4-4.5L2.5 12l4.3-2.2L4.5 6l4.6 1.2 1-4.7L12 2.5z" /><circle cx="12" cy="12" r="3" />
    </svg>
);
const IcoGear: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.8l1 2.6a6.9 6.9 0 012.2.9l2.6-.9 1.9 3.2-2 1.9c.1.4.1.9.1 1.3s0 .9-.1 1.3l2 1.9-1.9 3.2-2.6-.9c-.7.4-1.4.7-2.2.9l-1 2.6h-3.7l-1-2.6a6.9 6.9 0 01-2.2-.9l-2.6.9-1.9-3.2 2-1.9a7.6 7.6 0 010-2.6l-2-1.9 1.9-3.2 2.6.9c.7-.4 1.4-.7 2.2-.9l1-2.6h1.9z" />
    </svg>
);
const IcoTrash: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6.5 7l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4l.8-12M10 11v6M14 11v6" />
    </svg>
);
const IcoCheck: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M4.5 12.5l5 5 10-11" />
    </svg>
);
const IcoX: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className} aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
    </svg>
);
const IcoPlus: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className} aria-hidden>
        <path d="M12 5v14M5 12h14" />
    </svg>
);
const IcoReset: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M4 5v5h5M20 19v-5h-5" /><path d="M19.4 10A8 8 0 005.6 6.6L4 10M4.6 14a8 8 0 0013.8 3.4L20 14" />
    </svg>
);
const IcoBack: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
);
const IcoChevR: React.FC<IconProps> = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
);

// 宠物对战写进角色记忆的统一格式：必须是 MemoryFragment 对象（同 GameApp），
// 聊天侧 ContextBuilder 按 m.date/m.summary 过滤当月记录读取；裸字符串会让聊天构建 prompt 时读 m.date 崩掉。
const petMemFrag = (line: string) => {
    const now = new Date();
    return {
        id: `petpvp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
        summary: line,
        mood: 'rec' as const,
    };
};
// 就地追加一句到 char.memories（老存档是纯字符串的保留字符串追加，避免混型）。
// 同时把当月写进 activeMemoryMonths：主聊天的详细记忆段按激活月份过滤，
// 不激活的话对战记忆永远进不了 system prompt——表现为「打完游戏别处问就不记得」。
const pushMemLine = (char: any, line: string) => {
    const raw = char.memories;
    if (Array.isArray(raw)) char.memories = [...raw.slice(-29), petMemFrag(line)];
    else char.memories = [...String(raw || '').split('\n').slice(-29), line];
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cur = Array.isArray(char.activeMemoryMonths) ? char.activeMemoryMonths : [];
    if (!cur.includes(monthKey)) char.activeMemoryMonths = [...cur, monthKey];
};

const PetPvpApp: React.FC = () => {
    const { closeApp, characters, apiConfig, memoryPalaceConfig, addToast, userProfile, updateCharacter, groups, apiPresets } = useOS();

    const [tab, setTab] = useState<Tab>('gacha');
    const [pets, setPets] = useState<Pet[]>([]);
    const [battles, setBattles] = useState<PetBattleRecord[]>([]);
    const [meta, setMeta] = useState<PetMeta>({ id: 'main', goldByChar: {}, totalStatPoints: STAT_POINTS_DEFAULT });
    const [loaded, setLoaded] = useState(false);

    // 抽奖状态
    const [gachaCharId, setGachaCharId] = useState<string>('user');
    // 批量抽奖：多选对象列表（默认 = 只选了当前 gachaCharId 那一位；勾多人 = 批量）
    const [gachaMultiIds, setGachaMultiIds] = useState<Set<string>>(new Set(['user']));
    const [gachaMultiMode, setGachaMultiMode] = useState(false);
    const [gachaAddOpen, setGachaAddOpen] = useState(false); // 「添加抽卡角色」通讯录弹窗
    const [lastRolled, setLastRolled] = useState<Pet | null>(null);
    // 十连抽结果卡：一次弹窗列全部（最后一只大图+其余列表）
    const [resultModal, setResultModal] = useState<null | { pet: Pet }>(null);
    const [batchResults, setBatchResults] = useState<Pet[] | null>(null);
    const [lastEval, setLastEval] = useState('');
    const [drawing, setDrawing] = useState(false);
    // 抽卡两张弹窗：animScene=盲文翻找动画（点抽签立即出现）/ resultModal=结果介绍卡（动画消失后另开一张）
    const [animScene, setAnimScene] = useState<null | { pet: Pet }>(null);
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
    // 出千 / 战后感言横幅 / 败者惩罚（转盘弹窗）
    // 出千改开场选择：battleIntro=点开战后「要不要出千」的弹窗数据；activeCheat=本场生效中的出千（关掉=null）
    const [battleIntro, setBattleIntro] = useState<null | { a: PetCombatant; b: PetCombatant; userSide: 'a' | 'b' }>(null);
    const [activeCheat, setActiveCheat] = useState<null | { buff: Parameters<typeof simulateContinue>[4]; text: string }>(null);
    const [narrating, setNarrating] = useState(false);
    const [wheelModal, setWheelModal] = useState<null | { loserCharId: string; winnerCharId: string }>(null);
    const [wheelRotation, setWheelRotation] = useState(0);
    const [wheelSpun, setWheelSpun] = useState<null | { text: string; memSaved: boolean }>(null);
    const [tplModalOpen, setTplModalOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false); // 设置弹窗（顶栏齿轮）
    const [promptTab, setPromptTab] = useState<'gacha' | 'battle' | 'punish' | 'bet'>('gacha'); // 设置弹窗里的提示词选项栏
    const [punishResult, setPunishResult] = useState<null | { text: string; memSaved: boolean }>(null);
    // 自定义盲文多帧编辑：每帧一个框（本地编辑态，存库时按空行合并）
    const [frameBoxes, setFrameBoxes] = useState<string[] | null>(null);

    const charNameOf = (id: string) => id === 'user' ? (userProfile.name || '我') : (characters.find(c => c.id === id)?.name || '未知');
    const charAvatarOf = (id: string) => id === 'user' ? userProfile.avatar : characters.find(c => c.id === id)?.avatar;
    // 参与者名单：用户本人（可抽奖/参战）+ 所有 AI 角色
    const participants = useMemo(() => ([
        { id: 'user', name: userProfile.name || '我', avatar: userProfile.avatar },
        ...characters.map(c => ({ id: c.id, name: c.name, avatar: c.avatar })),
    ]), [characters, userProfile]);

    // 战况日志自动滚到最新：回放每拍（eventIdx）、手动改写事件（出千开/关）、新战报进来都跟着滚
    useEffect(() => {
        if (!arena || !logRef.current) return;
        const stick = () => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; };
        requestAnimationFrame(stick);
        // intro→battle 的 max-h 展开动画要 700ms，展开完再补一次才贴底
        const t = setTimeout(stick, 750);
        return () => clearTimeout(t);
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
            // 装载即静默补账：上一场回放被关掉/没打完的（uncommitted）按记录胜负补结算 + 压记忆。
            // 原来只在下一场开打前补——用户打完一场就收工的话，那场永远挂在未结算状态，
            // 战绩页有记录但金币/删宠/记忆全没跟上（这就是「对战没正确计入历史」的另一半根因）。
            const chars = await DB.getAllCharacters();
            const battlesNow = bs;
            let changed = false;
            for (const rec of battlesNow) {
                if (rec.committed && rec.memorySaved) continue;
                if (!rec.committed) {
                    const loserPetId = rec.winnerCharId === rec.aCharId ? rec.bPetId : rec.aPetId;
                    if (loserPetId) {
                        await DB.deletePet(loserPetId);
                    }
                    rec.committed = true;
                    changed = true;
                }
                if (!rec.memorySaved) {
                    const oneLiner = `${new Date(rec.createdAt).toLocaleDateString('zh-CN')}，${rec.aName}与 ${rec.bName} 进行了宠物对战，获胜方：${rec.aCharId === rec.winnerCharId ? rec.aName : rec.bName}。`;
                    for (const cid of [rec.aCharId, rec.bCharId]) {
                        if (cid === 'user') continue;
                        const char = chars.find(c => c.id === cid) as any;
                        if (!char) continue;
                        pushMemLine(char, oneLiner);
                    }
                    rec.memorySaved = true;
                    changed = true;
                }
                await DB.savePetBattle(rec);
            }
            if (changed) {
                // 补记忆（updateCharacter 走 context 的落库通道，这里直接写回 DB）
                for (const c of chars) {
                    const char = c as any;
                    if (battlesNow.some(rec => [rec.aCharId, rec.bCharId].includes(char.id))) {
                        await DB.saveCharacter(char);
                    }
                }
                setBattles([...battlesNow]);
            }
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

    // ─── AI 调用配置：战报/抽卡各自独立选一个 API 预设（不设 = 回落主聊天 API），与群聊/私聊互不影响 ───
    // 旧存档的 modelMode='sub'（记忆宫殿副API）继续兼容：没选预设且旧值是 sub 时仍走 lightLLM。
    const pickModel = (purpose: 'gacha' | 'battle') => {
        const presetId = purpose === 'gacha' ? meta.apiPresetIdGacha : meta.apiPresetIdBattle;
        const preset = presetId ? apiPresets.find(p => p.id === presetId) : undefined;
        if (preset?.config?.baseUrl) {
            const c = preset.config as { baseUrl: string; apiKey?: string; model?: string; temperature?: number };
            return { baseUrl: c.baseUrl, apiKey: c.apiKey || '', model: c.model || apiConfig.model };
        }
        // 旧版兼容：sub 模式回落记忆宫殿副 API
        const llm = memoryPalaceConfig?.lightLLM?.baseUrl ? memoryPalaceConfig.lightLLM : null;
        if (meta.modelMode !== 'main' && llm && llm.baseUrl && llm.apiKey) return llm;
        return { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
    };

    // 角色提示词组装（和私聊一模一样的调用：ContextBuilder.buildCoreContext 完整输出
    // ——世界书/世界观/印象/记忆库全在里面，零截断。近期消息只用于激活关键词条目）
    const buildCharPrompt = async (charId: string) => {
        if (charId === 'user') return `【用户本人】${userProfile.name || '我'}（你就是用户本人，用户的口吻随意自然）`;
        const char = characters.find(c => c.id === charId);
        if (!char) return '';
        let core = '';
        try {
            const recentMsgs = await DB.getRecentMessagesByCharId(charId, 100);
            core = ContextBuilder.buildCoreContext(char, userProfile, true, undefined, undefined, { worldbookMessages: recentMsgs as any });
        } catch { /* ignore */ }
        let palace = '';
        try { palace = String(await injectMemoryPalace(char, undefined, '宠物对战') || ''); } catch { /* ignore */ }
        return palace ? `${core}\n${palace}` : core;
    };

    // ─── 抽奖（脚本出结果；角色抽卡调一次 API 让角色评价；user 抽卡纯脚本）───
    // ─── 抽奖（脚本出结果；角色抽卡调一次 API 让角色评价；user 抽卡纯脚本）───
    // 掷一只宠物（纯脚本，不落库）
    const rollOnePet = (): Pet => {
        const grade = rollGrade();
        const atk = rollAtk(grade);
        const stats = rollStats(meta.totalStatPoints);
        const hp = rollHpByGrade(grade);
        const hitTpl = rollPool(templates, BATTLE_MISS_WEIGHT);
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
        return {
            id: `pet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'pet',
            ownerId: 'user', // 由调用方覆盖
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
    };

    // 抽卡入口：drawCount=1 单抽 / 10 十连；targets = 批量对象列表（多选模式），单选模式 = 当前 gachaCharId
    const doGacha = async (drawCount: 1 | 10 = 1) => {
        // 多选模式 = 勾选列表里的每个人各抽 drawCount 只；单选 = 当前一人
        const targets = gachaMultiMode
            ? [...gachaMultiIds].filter(Boolean)
            : [gachaCharId || 'user'];
        if (!targets.length) { addToast('先选谁来抽', 'error'); return; }
        // 金币预检：任何一人金币不够就整单拒绝（避免抽一半没钱）
        const poor = targets.find(id => goldOf(id) < GACHA_COST * drawCount);
        if (poor !== undefined) { addToast(`${charNameOf(poor)} 金币不足（需 ${GACHA_COST * drawCount}）`, 'error'); return; }
        // 掷 + 扣钱 + 落库
        const allPets: Pet[] = [];
        for (const id of targets) {
            await setGoldOf(id, goldOf(id) - GACHA_COST * drawCount);
            for (let i = 0; i < drawCount; i++) {
                const pet = { ...rollOnePet(), ownerId: id };
                await DB.savePet(pet);
                allPets.push(pet);
            }
        }
        setPets(prev => [...prev, ...allPets]);
        // 批量/十连：每人的第一只做代表（评价也只评代表）
        const hero = allPets[0];
        setLastRolled(hero);
        setLastEval('');
        setBatchResults(allPets.length > 1 ? allPets : null);
        // 动画弹窗立即出现（整单只播一次），最短播 DIG_MIN_MS；结果卡另开
        animStartRef.current = Date.now();
        setAnimScene({ pet: hero });
        const minPlay = new Promise<void>(r => setTimeout(r, Math.max(0, DIG_MIN_MS - (Date.now() - animStartRef.current))));
        // 只有一个 NPC 抽卡时才调 API 评价（批量多人会烧钱，不调）；user 抽卡不调
        const npcDrawers = [...new Set(allPets.map(p => p.ownerId))].filter(id => id !== 'user');
        const openResult = (evalText: string) => {
            if (evalText) { hero.evalText = evalText; DB.savePet(hero).catch(() => {}); setLastEval(evalText); }
            setAnimScene(null);
            setResultModal({ pet: { ...hero } });
        };
        if (!npcDrawers.length || npcDrawers.length > 1) {
            await minPlay;
            openResult('');
            return;
        }
        const charId = npcDrawers[0];
        setDrawing(true);
        try {
            const evalPromise = (async () => {
                try {
                    const persona = await buildCharPrompt(charId);
                    const prompt = (meta.promptGacha || PROMPT_GACHA_DEFAULT)
                        .split('{人设}').join(persona)
                        .split('{名字}').join(hero.name)
                        .split('{品级}').join(hero.grade)
                        .split('{攻击}').join(String(hero.atk))
                        .split('{敏捷}').join(String(hero.stats.spd))
                        .split('{闪避}').join(String(hero.stats.dodge))
                        .split('{暴击}').join(String(hero.stats.crit))
                        .split('{血量}').join(String(hero.hp));
                    const cfg = pickModel('gacha');
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
    // 品级匹配挑宠（脚本匹配，尽量同级）：每方出自己拥有的最高品级那只——
    // 双方都有 A → A对A；一方没有 A → 那方自动降级出自己的最高档（A对B 以此类推）。
    // 同档多只时默认出战的宠物优先，其次最早抽的。默认出战指定不再跨档生效（防 S 级打 C 级悬殊局）。
    const GRADE_ORDER: PetGrade[] = ['A', 'B', 'C', 'D', 'E'];
    const gradePickPet = (charId: string): Pet | null => {
        const list = aliveByChar(charId).slice().sort((a, b) => a.createdAt - b.createdAt);
        if (!list.length) return null;
        const best = GRADE_ORDER.find(g => list.some(p => p.grade === g)) || 'E';
        const inGrade = list.filter(p => p.grade === best);
        const defId = meta.defaultPetByChar?.[charId];
        return inGrade.find(p => p.id === defId) || inGrade[0];
    };
    const combatantOf = (charId: string): PetCombatant | null => {
        const pet = gradePickPet(charId);
        if (!pet) return null;
        return buildCombatant(pet, charId, charNameOf(charId), meta.totalStatPoints);
    };
    const pickRandomCharWithPet = (exclude?: string) => {
        const pool = alivePets.map(p => p.ownerId).filter(id => id !== exclude);
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    };
    const resolveSides = (): [PetCombatant, PetCombatant] | null => {
        const owners = alivePets.map(p => p.ownerId);
        let aId: string;
        let bId: string;
        if (mode === 'rvr') {
            // 随机 vs 随机：两个都由脚本随机抽（有宠物的角色里），没有指定方
            aId = pickRandomCharWithPet();
            bId = pickRandomCharWithPet(aId);
        } else {
            aId = sideAChar || 'user';
            bId = sideBChar;
            if (mode === 'avs' && !bId) bId = pickRandomCharWithPet(aId);
        }
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
                pushMemLine(char, oneLiner);
                updateCharacter(cid, { memories: char.memories, activeMemoryMonths: char.activeMemoryMonths });
            }
            b.memorySaved = true;
            await DB.savePetBattle(b);
        }
    };

    // 押注/败方宠物结算保险：回放被打断没 commit 的旧战报，在下一场开打前按其记录的胜负补结算
    const commitPendingRecords = async () => {
        for (const rec of battles) {
            if (rec.committed) continue;
            const loserPetId = rec.winnerCharId === rec.aCharId ? rec.bPetId : rec.aPetId;
            if (loserPetId) {
                await DB.deletePet(loserPetId);
                setPets(prev => prev.filter(p => p.id !== loserPetId));
            }
            rec.committed = true;
            await DB.savePetBattle(rec);
        }
    };

    const startBattle = async () => {
        const sides = resolveSides();
        if (!sides) return;
        const [a, b] = sides;
        // user 参战 → 先弹「本场要不要出千」的选择；NPC 对战（rvr 等）直接开打
        const userSide = a.charId === 'user' ? 'a' : b.charId === 'user' ? 'b' : null;
        if (userSide) { setBattleIntro({ a, b, userSide }); return; }
        await beginBattle(a, b, null);
    };

    // 真正开战：openingCheat 非空 = user 开场选了出千（untilRound>0 才真生效；被抓/搞砸只播一条战况）
    const beginBattle = async (a: PetCombatant, b: PetCombatant, openingCheat: null | { buff: NonNullable<Parameters<typeof simulateContinue>[4]>; text: string }) => {
        // 本场生效中的出千（「关闭出千」按钮的依据）；被抓/搞砸（untilRound 0）和 NPC 对战都清掉
        setActiveCheat(openingCheat && openingCheat.buff.untilRound > 0 ? openingCheat : null);
        // 押注只扣本金（派彩等回放结束按最终胜负结算——出千可能翻转结果）；仅赌钱模式有效
        const betActive = (meta.punishMode || 'wheel') === 'bet';
        if (betActive && betSide && betAmount > 0) {
            const userGold = goldOf('user');
            if (userGold < betAmount) { addToast('你的金币不够押注', 'error'); return; }
            await setGoldOf('user', userGold - betAmount);
        }
        setBattling(true);
        try {
            // 0. 上一场未 commit 的先补结算，再把之前未压缩的战报压成一句话记忆
            await commitPendingRecords();
            await compressPendingBattleMemories();
            // 1. 脚本模拟（战斗结果 + 赔率预演）——纯脚本，无 AI；开场出千的 buff 在这里生效
            const result = simulateBattle(a, b, BATTLE_MAX_ROUNDS, openingCheat || undefined);
            const sim = estimateOdds(a, b, 200);
            const winnerCharId = result.winner === 'a' ? a.charId : b.charId;
            // 2. 押注信息（won/派彩推迟到回放结束）
            let bet: PetBattleRecord['bet'];
            if (betActive && betSide && betAmount > 0) {
                bet = { side: betSide, amount: betAmount, odds: betSide === 'a' ? sim.oddsA : sim.oddsB, won: false, settled: false };
            }
            // 3. 落库：败方宠物删除与押注派彩都推迟到回放结束（committed）——出千可能翻转结果
            const record: PetBattleRecord = {
                id: `pb-${Date.now()}`,
                aCharId: a.charId, bCharId: b.charId,
                aName: a.name, bName: b.name,
                aPetId: a.petId, bPetId: b.petId,
                rounds: result.rounds,
                winnerCharId,
                bet,
                committed: false,
                createdAt: Date.now(),
            };
            await DB.savePetBattle(record);
            setBattles(prev => [...prev, record]);
            // 4. 打开战斗页面逐拍回放，结束后结算 + AI 生成「败方评价 + 胜方回复」
            setPunishResult(null);
            setNarrating(false);
            setEventIdx(0);
            setArenaPhase('intro');
            setArena({ a, b, events: result.events, winner: result.winner, record });
            setBattleIntro(null); // 出千选择弹窗（若有）一并关掉
        } finally {
            setBattling(false);
        }
    };

    // 追加一句记忆到角色（战报压缩/惩罚共用；user 没有角色档案，写进对手角色的
    // 记忆——Sully 记住「User 被罚学猫叫」，之后聊天才会拿这事调侃 user）。
    // 必须写 MemoryFragment 对象（同 GameApp），聊天侧 ContextBuilder 按 m.date/m.summary 读取；
    // 老存档 memories 是纯字符串的保留字符串追加，避免混型。
    const appendCharMemory = (charId: string, line: string, fallbackCharId?: string) => {
        const target = charId === 'user' ? (fallbackCharId && fallbackCharId !== 'user' ? fallbackCharId : null) : charId;
        if (!target) return;
        const char = characters.find(c => c.id === target) as any;
        if (!char) return;
        pushMemLine(char, line);
        updateCharacter(target, { memories: char.memories, activeMemoryMonths: char.activeMemoryMonths });
    };

    // 回放结束 → ①按最终胜负结算（删败方宠物 + 押注派彩，出千可能翻转结果）②调 API 生成「败方评价 + 胜方回复」
    useEffect(() => {
        if (!arena || arenaPhase !== 'battle') return;
        if (eventIdx < arena.events.length - 1) return;
        // ① 未 commit：先按最终结果结算（本 effect 会在 setArena 后再进来走到 ②）
        if (!arena.record.committed) {
            (async () => {
                const winSide = arena.winner;
                const loserSide: 'a' | 'b' = winSide === 'a' ? 'b' : 'a';
                const loserPetId = loserSide === 'a' ? arena.a.petId : arena.b.petId;
                if (loserPetId) {
                    await DB.deletePet(loserPetId);
                    setPets(prev => prev.filter(p => p.id !== loserPetId));
                }
                const record: PetBattleRecord = { ...arena.record, winnerCharId: winSide === 'a' ? arena.a.charId : arena.b.charId, committed: true };
                if (record.bet && !record.bet.settled && (meta.punishMode || 'wheel') === 'bet') {
                    const won = record.bet.side === record.winnerCharId;
                    const payout = won ? Math.round(record.bet.amount * record.bet.odds) : 0;
                    if (payout > 0) await setGoldOf('user', goldOf('user') + payout);
                    record.bet = { ...record.bet, won, settled: true };
                    addToast(won ? `押中！赢得 ${payout} 金币` : `押错了，损失 ${record.bet.amount} 金币`, won ? 'success' : 'error');
                }
                await DB.savePetBattle(record);
                setBattles(prev => prev.map(x => x.id === record.id ? record : x));
                setArena(cur => cur && cur.record.id === record.id ? { ...cur, record } : cur);
                // 当场把这场战报压进双方角色记忆（原来要等下一场开打才补，最后一场永远进不了记忆）
                {
                    const oneLiner = `${new Date(record.createdAt).toLocaleDateString('zh-CN')}，${record.aName}（${charNameOf(record.aCharId)}）与 ${record.bName}（${charNameOf(record.bCharId)}）进行了宠物对战，${charNameOf(record.winnerCharId)} 的宠物获胜。`;
                    for (const cid of [record.aCharId, record.bCharId]) {
                        if (cid === 'user') continue;
                        const char = characters.find(c => c.id === cid) as any;
                        if (!char) continue;
                        pushMemLine(char, oneLiner);
                        updateCharacter(cid, { memories: char.memories, activeMemoryMonths: char.activeMemoryMonths });
                    }
                    (record as any).memorySaved = true;
                    await DB.savePetBattle(record);
                    setBattles(prev => prev.map(x => x.id === record.id ? record : x));
                }
                // 赌钱惩罚：败者立刻赔给赢家（转盘模式由用户手点）
                if ((meta.punishMode || 'wheel') === 'bet') {
                    const loserCharId = loserSide === 'a' ? arena.a.charId : arena.b.charId;
                    const winnerCharId = record.winnerCharId;
                    const amount = Math.max(1, Math.min(meta.punishBetAmount ?? 100, goldOf(loserCharId)));
                    if (amount > 0) {
                        await setGoldOf(loserCharId, goldOf(loserCharId) - amount);
                        await setGoldOf(winnerCharId, goldOf(winnerCharId) + amount);
                        const line = `${new Date().toLocaleDateString('zh-CN')}，${charNameOf(loserCharId)} 在宠物对战中败给 ${charNameOf(winnerCharId)}，接受赌钱惩罚：赔了 ${amount} 金币。`;
                        // 败者视角写一条（user 败则由胜者 NPC 替记）；胜者只在败者是 NPC 时另写，
                        // 否则 user 败时同一句会在胜者 NPC 记忆里重复两条
                        if (loserCharId !== 'user') appendCharMemory(loserCharId, line, winnerCharId);
                        if (winnerCharId !== 'user') appendCharMemory(winnerCharId, line, loserCharId);
                        setPunishResult({ text: `${charNameOf(loserCharId)} 赔给 ${charNameOf(winnerCharId)} ${amount} 金币`, memSaved: loserCharId !== 'user' || winnerCharId !== 'user' });
                    }
                }
                // 随机 vs 随机（双方都是 NPC）：各自调一次 API 吐槽/炫耀/带话，发到两人都在的群；没有就私发给 user
                if (arena.a.charId !== 'user' && arena.b.charId !== 'user') {
                    const commonGroup = groups.find(g => g.members.includes(arena.a.charId) && g.members.includes(arena.b.charId));
                    for (const side of [arena.a, arena.b] as const) {
                        const foe = side === arena.a ? arena.b : arena.a;
                        const won = record.winnerCharId === side.charId;
                        announceChatGen(CHAT_GEN_EVENTS.replyStart, { charId: side.charId, charName: side.charName });
                        (async (sideArg, foeArg, sideWon) => {
                            let text = '';
                            try {
                                const persona = await buildCharPrompt(sideArg.charId);
                                const prompt = PROMPT_RVR_TALK_DEFAULT
                                    .split('{人设}').join(persona)
                                    .split('{我方宠物}').join(sideArg.name)
                                    .split('{对方主人}').join(foeArg.charName)
                                    .split('{对方宠物}').join(foeArg.name)
                                    .split('{结果}').join(sideWon ? `你的「${sideArg.name}」赢了` : `你的「${sideArg.name}」输给了对方的「${foeArg.name}」`);
                                const cfg = pickModel('battle');
                                const data = await safeFetchJson(
                                    `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                                    {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                                        body: JSON.stringify({
                                            model: cfg.model,
                                            messages: [
                                                { role: 'system', content: prompt },
                                                { role: 'user', content: '说说吧。' },
                                            ],
                                            temperature: 0.9, max_tokens: 1024, stream: false,
                                        }),
                                    },
                                    1, 60_000, { appName: '宠物对战', purpose: '随机对战发言' },
                                );
                                const d2 = await data;
                                text = extractContent(d2).slice(0, 200);
                            } catch { /* 失败就安静跳过 */ }
                            if (text) {
                                await DB.saveMessage(commonGroup
                                    ? { charId: sideArg.charId, groupId: commonGroup.id, role: 'assistant', type: 'text', content: text }
                                    : { charId: sideArg.charId, role: 'assistant', type: 'text', content: text });
                                announceChatGen(CHAT_GEN_EVENTS.replyArrived, { charId: sideArg.charId, charName: sideArg.charName });
                                // 发给 user 私聊的那条（不在群里）才拉小窗；群消息走通讯录「群里聊」跳转
                                if (!commonGroup) {
                                    window.dispatchEvent(new CustomEvent('petpvp-minichat-open', { detail: { charId: sideArg.charId } }));
                                }
                            }
                            announceChatGen(CHAT_GEN_EVENTS.replyEnd, { charId: sideArg.charId, charName: sideArg.charName });
                        })(side, foe, won);
                    }
                }
            })();
            return;
        }
        // ② 战后感言（已 commit 才按最终胜负要播报）。模式：导演=一次 API 整段（默认）；
        // 轮调=败者、胜者各调一次 API 按顺序落库（各说各话，先败后胜），共用 narrating 横幅。
        // 轮盘模式不出战后感言：整场唯一一次 API 是抽完转盘后的惩罚回应（对战→战报→抽轮盘→调用）。
        if ((meta.punishMode || 'wheel') === 'wheel') return;
        if (arena.record.narration) return;
        const replyMode = meta.battleReplyMode || 'director';
        if (replyMode === 'roundRobin') {
            (async () => {
                const { a, b, record } = arena;
                const loser = record.winnerCharId === a.charId ? b : a;
                const winner = record.winnerCharId === a.charId ? a : b;
                setNarrating(true);
                const lines: string[] = [];
                try {
                    for (const speaker of [loser, winner]) {
                        const persona = await buildCharPrompt(speaker.charId);
                        const isLoser = speaker === loser;
                        const prompt = (meta.promptBattle || PROMPT_BATTLE_DEFAULT)
                            .split('{A人设}').join(await buildCharPrompt(a.charId))
                            .split('{B人设}').join(await buildCharPrompt(b.charId))
                            .split('{A主人}').join(a.charId === 'user' ? (userProfile.name || '我') : a.charName)
                            .split('{B主人}').join(b.charId === 'user' ? (userProfile.name || '我') : b.charName)
                            .split('{A名}').join(a.name)
                            .split('{B名}').join(b.name)
                            .split('{胜者}').join(charNameOf(record.winnerCharId))
                            .split('{A宠物}').join(`宠物「${a.name}」（${a.grade}级 · 攻击 ${a.atk}）`)
                            .split('{B宠物}').join(`宠物「${b.name}」（${b.grade}级 · 攻击 ${b.atk}）`)
                            .split('{脚本战报}').join(record.rounds.join('\n'))
                            .split('{败者主人}').join(charNameOf(loser.charId))
                            .split('{胜者主人}').join(charNameOf(winner.charId))
                            .split('{败者角色}').join(loser.charName)
                            .split('{胜者角色}').join(winner.charName)
                            + (speaker.charId === 'user'
                                ? `\n\n你现在要发言了（你是${isLoser ? '败者' : '胜者'}本人），请用你自己的口吻说一两句话（40 字以内），直接输出，不要输出其他内容。`
                                : `\n\n你现在要发言了（你是${isLoser ? '败者' : '胜者'}${speaker.charName}），请用你自己的口吻说一两句话（40 字以内），直接输出，不要输出其他内容。`);
                        const cfg = pickModel('battle');
                        const data = await safeFetchJson(
                            `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                                body: JSON.stringify({
                                    model: cfg.model,
                                    messages: [
                                        { role: 'system', content: persona },
                                        { role: 'user', content: prompt },
                                    ],
                                    temperature: 0.9, max_tokens: 1024, stream: false,
                                }),
                            },
                            1, 120_000, { appName: '宠物对战', purpose: '战后评价' },
                        );
                        const d2 = await data;
                        const text = extractContent(d2).slice(0, 200);
                        if (text) lines.push(`${speaker.charId === 'user' ? (userProfile.name || '我') : speaker.charName}：${text}`);
                    }
                } catch { /* 失败 → 脚本战报兜底 */ }
                if (lines.length) {
                    record.narration = lines.join('\n');
                    record.promptSent = '（轮调模式：败者/胜者各自单独调用）';
                    await DB.savePetBattle(record);
                    setArena(cur => (cur && cur.record.id === record.id ? { ...cur, record: { ...record } } : cur));
                }
                setNarrating(false);
            })();
            return;
        }
        (async () => {
            const { a, b, record } = arena;
            const cfg = pickModel('battle');
            setNarrating(true);
            try {
                const personaA = await buildCharPrompt(a.charId);
                const personaB = await buildCharPrompt(b.charId);
                const loser = record.winnerCharId === a.charId ? b : a;
                const winner = record.winnerCharId === a.charId ? a : b;
                const petSheet = (c: PetCombatant) => `宠物「${c.name}」（${c.grade}级 · 攻击 ${c.atk} · 敏捷 ${c.spd}/闪避 ${c.dodge}/暴击 ${c.crit} · HP ${c.maxHp}）`;
                // 赌钱模式：把压金信息注入战报提示词（{押金} 占位符 + 默认追加一段）
                let stakeBlock = '';
                if ((meta.punishMode || 'wheel') === 'bet' && meta.punishBetAmount) {
                    stakeBlock = `\n\n【压金】${charNameOf(loser.charId)} 押 ${charNameOf(winner.charId)} ${meta.punishBetAmount} 金币打这场（败者结算时赔给赢家），双方都知道这场是带赌注的。`;
                }
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
                    .split('{押金}').join((meta.punishMode || 'wheel') === 'bet' ? `${meta.punishBetAmount ?? 100} 金币` : '')
                    .split('{败者主人}').join(charNameOf(loser.charId))
                    .split('{胜者主人}').join(charNameOf(winner.charId))
                    .split('{败者角色}').join(loser.charName)
                    .split('{胜者角色}').join(winner.charName)
                    + stakeBlock;
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
            } catch { /* 播报失败 → 脚本战报兜底 */ } finally {
                setNarrating(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [arena, arenaPhase, eventIdx]);

    // ─── 出千（开场选择制）：开战弹窗里 user 决定本场要不要出千。成功 = 随机属性全场
    // 翻倍，直到 user 手动「关闭出千」或战斗结束；被抓 = 当场取消（无翻倍）；搞砸 =
    // 什么都没发生。三种结果都写进战况。概率沿用设置里的 cheatSuccessRate/cheatCaughtRate ───
    // 掷开场出千：untilRound>0 = 真生效（全场）；被抓/搞砸 = untilRound 0（永不生效，
    // 但引擎照播 cheat 战况事件，三种结果都会出现在战斗日志里）
    const rollOpeningCheat = (userSide: 'a' | 'b', me: PetCombatant, foe: PetCombatant): { buff: NonNullable<Parameters<typeof simulateContinue>[4]>; text: string } => {
        const success = Math.random() * 100 < (meta.cheatSuccessRate ?? 65);
        const caught = success && Math.random() * 100 < (meta.cheatCaughtRate ?? 35);
        const stat = (['crit', 'spd', 'dodge'] as const)[Math.floor(Math.random() * 3)];
        const statName = stat === 'crit' ? '暴击' : stat === 'spd' ? '敏捷' : '闪避';
        const effective = success && !caught;
        const text = effective
            ? `【出千】${charNameOf('user')} 赛前偷偷给 ${me.name} 做了手脚——${statName} 全场翻倍（手动关闭或战斗结束前一直生效），没有被察觉…`
            : success
                ? `【出千】${me.name} 的 ${statName} 刚要翻倍，就被 ${foe.name} 当场抓包——手脚被拍掉，无效！`
                : `【出千】${charNameOf('user')} 想给 ${me.name} 做手脚，结果手一抖搞砸了，什么都没发生。`;
        return { buff: { side: userSide, stat, untilRound: effective ? BATTLE_MAX_ROUNDS + 1 : 0 }, text };
    };

    // 出千选择弹窗的按钮：正常打 → 直接开战；出千 → 掷完再开战
    const startWithCheat = async (wantCheat: boolean) => {
        if (!battleIntro) return;
        const { a, b, userSide } = battleIntro;
        const me = userSide === 'a' ? a : b;
        const foe = userSide === 'a' ? b : a;
        const openingCheat = wantCheat ? rollOpeningCheat(userSide, me, foe) : null;
        setBattleIntro(null);
        await beginBattle(a, b, openingCheat);
    };

    // 「关闭出千」：从当前回放位置无 buff 续打（属性翻倍即刻停止），事件/战报改写沿用旧机制
    const closeCheat = () => {
        if (!arena || !activeCheat || arena.record.committed) return;
        const ev = arena.events[Math.min(eventIdx, arena.events.length - 1)];
        const cheatOffText = `【出千】${charNameOf('user')} 悄悄收回了手脚——${arena.a.charId === 'user' ? arena.a.name : arena.b.name} 的翻倍效果即刻停止。`;
        const cheatOffEvent: BattleEvent = { kind: 'cheat', atkSide: activeCheat.buff!.side, round: ev.round, text: cheatOffText, hpA: ev.hpA, hpB: ev.hpB };
        // 从下一回合无 buff 接着打（先手 = 本事件攻击方的对方）；剩余回合不足则按血量判定
        const cont = simulateContinue(arena.a, arena.b, { hpA: ev.hpA, hpB: ev.hpB, round: ev.round + 1, attackerIsA: ev.atkSide === 'b' }, BATTLE_MAX_ROUNDS, undefined);
        const shownNonChain = arena.events.slice(0, eventIdx + 1).filter(e => e.kind !== 'chain').length;
        setActiveCheat(null);
        setArena({
            ...arena,
            events: [...arena.events.slice(0, eventIdx + 1), cheatOffEvent, ...cont.events],
            winner: cont.winner,
            record: { ...arena.record, rounds: [...arena.record.rounds.slice(0, shownNonChain), cheatOffText, ...cont.rounds] },
        });
    };

    // ─── 败者惩罚转盘（圆形弹窗）：旋转落定 → 写记忆 → 调 API 生成回应 → 发进败者私聊（横幅=私聊同款，弹窗随时可关）───
    const wheelItemsActive = () =>
        (meta.wheelItems && meta.wheelItems.length ? meta.wheelItems : WHEEL_ITEMS_DEFAULT).filter(i => (i.weight || 0) > 0 && i.text.trim());
    const togglePunishMode = async () => {
        const next = { ...meta, punishMode: (meta.punishMode || 'wheel') === 'wheel' ? 'bet' as const : 'wheel' as const };
        setMeta(next);
        await DB.savePetMeta(next);
        addToast(next.punishMode === 'wheel' ? '惩罚切换为：转盘模式' : '惩罚切换为：赌钱模式', 'success');
    };
    const runWheelSpin = async () => {
        if (!wheelModal) return;
        const { loserCharId, winnerCharId } = wheelModal;
        const items = wheelItemsActive();
        if (!items.length) { addToast('转盘是空的，先去设置里加惩罚条目', 'error'); return; }
        setWheelSpun(null);
        // 按权重落定，圆盘转 4 圈以上停在扇区中心
        const total = items.reduce((s, i) => s + (i.weight || 0), 0);
        let r = Math.random() * total;
        let pickedIdx = items.length - 1;
        let cum = 0;
        const centers: number[] = [];
        for (let i = 0; i < items.length; i++) {
            const sweep = (items[i].weight || 0) / total * 360;
            centers.push(cum + sweep / 2);
            cum += sweep;
        }
        let acc = 0;
        pickedIdx = items.length - 1;
        for (let i = 0; i < items.length; i++) {
            acc += items[i].weight || 0;
            if (r < acc) { pickedIdx = i; break; }
        }
        const targetMod = ((360 - centers[pickedIdx]) % 360 + 360) % 360;
        const current = wheelRotation % 360;
        const delta = ((targetMod - current) % 360 + 360) % 360;
        const target = wheelRotation + 360 * 4 + delta;
        setWheelRotation(target);
        await new Promise(rs => setTimeout(rs, 3400));
        const picked = items[pickedIdx];
        const line = `${new Date().toLocaleDateString('zh-CN')}，${charNameOf(loserCharId)} 在宠物对战中败给 ${charNameOf(winnerCharId)}，转盘抽到惩罚：${picked.text}。`;
        // 败者角色 → 写自己的记忆；败者是 user → 写进胜者角色的记忆（对手记得这场惩罚）
        appendCharMemory(loserCharId, line, winnerCharId);
        setWheelSpun({ text: picked.text, memSaved: true });
        setPunishResult({ text: picked.text, memSaved: true });
        const memOwner = loserCharId !== 'user' ? loserCharId : winnerCharId;
        addToast(`惩罚生效：${picked.text}${loserCharId !== 'user' ? '（回应将发到私聊）' : '（已写进对手记忆）'}`, 'success');
        // 角色败者 → 生成回应并发进私聊（请求横幅 = 私聊同款 ChatBroadcast；弹窗随时可关，请求后台继续）
        if (loserCharId !== 'user') {
            const loserName = charNameOf(loserCharId);
            announceChatGen(CHAT_GEN_EVENTS.replyStart, { charId: loserCharId, charName: loserName });
            (async () => {
                let reaction = '';
                try {
                    const persona = await buildCharPrompt(loserCharId);
                    const prompt = (meta.promptPunish || PROMPT_PUNISH_DEFAULT)
                        .split('{人设}').join(persona)
                        .split('{惩罚}').join(picked.text)
                        .split('{赢家}').join(charNameOf(winnerCharId));
                    const cfg = pickModel('battle');
                    const data = await safeFetchJson(
                        `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                            body: JSON.stringify({
                                model: cfg.model,
                                messages: [
                                    { role: 'system', content: prompt },
                                    { role: 'user', content: '认罚吧。' },
                                ],
                                temperature: 0.9, max_tokens: 1024, stream: false,
                            }),
                        },
                        1, 60_000, { appName: '宠物对战', purpose: '惩罚回应' },
                    );
                    const d2 = await data;
                    reaction = extractContent(d2).slice(0, 200);
                } catch { /* 回应失败不影响惩罚本身 */ }
                if (reaction) {
                    await DB.saveMessage({ charId: loserCharId, role: 'assistant', type: 'text', content: reaction });
                    announceChatGen(CHAT_GEN_EVENTS.replyArrived, { charId: loserCharId, charName: loserName });
                    // 落库即拉起小窗（MiniChatWindow 监听这个事件；点红点才是通讯录列表）
                    window.dispatchEvent(new CustomEvent('petpvp-minichat-open', { detail: { charId: loserCharId } }));
                }
                announceChatGen(CHAT_GEN_EVENTS.replyEnd, { charId: loserCharId, charName: loserName });
            })();
        }
    };

    // ─── 宠物形象渲染（多行点阵按容器缩放字号，等宽不歪）───
    const PetVisual: React.FC<{ pet: { imageRef?: string; kaomoji?: string; name: string }, size?: string, boxPx?: number }> = ({ pet, size = 'w-14 h-14', boxPx = 56 }) => {
        if (pet.imageRef) return <TokenImg value={pet.imageRef} className={`${size} rounded-xl object-cover border border-white/10`} />;
        const dot = pet.kaomoji || '';
        if (dot.includes('\n')) {
            const m = dotMeasure(dot);
            return (
                <div className={`${size} rounded-xl bg-[#E9E8DB] flex items-center justify-center overflow-hidden`}>
                    <pre className="font-mono whitespace-pre text-center text-slate-600" style={{ fontSize: dotFontPx(m.lines, m.cols, boxPx, boxPx), lineHeight: 1.15 }}>{dot}</pre>
                </div>
            );
        }
        return (
            <div className={`${size} rounded-xl bg-[#E9E8DB] flex items-center justify-center overflow-hidden`}>
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
                        <div className="flex-1 h-3.5 bg-[#E9E8DB] rounded-full overflow-hidden border border-[#AFA3A1]/30">
                            <div className={`h-full rounded-full transition-all duration-500 ${pct > 50 ? 'bg-[#AFA3A1]' : pct > 20 ? 'bg-[#DAD8C0]' : 'bg-[#E9E8DB]'}`}
                                style={{ width: `${pct}%`, marginLeft: side === 'b' ? 'auto' : undefined }} />
                        </div>
                    </div>
                    {/* 竖版宠物卡 */}
                    <div className={`rounded-2xl border-2 overflow-hidden transition-all duration-300 ${
                        isHurt ? 'border-[#AFA3A1] bg-[#E9E8DB]'
                            : isAttacking ? 'border-[#DAD8C0] bg-[#F9FBF5] scale-[1.02] shadow-lg shadow-[#DAD8C0]/50'
                            : 'border-[#AFA3A1]/30 bg-[#F9FBF5]'
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
                        <span className={`font-black text-[#AFA3A1] transition-all duration-700 ${intro ? 'text-2xl text-[#AFA3A1] scale-125' : 'text-sm'}`}>VS</span>
                    </div>
                    {sideColumn(arena.b, 'b', bAttacking, bHurt)}
                </div>
                {/* 下方：战况日志面板（intro 隐藏 → battle 滑入展开） */}
                <div className={`overflow-hidden transition-all duration-700 ease-out ${intro ? 'max-h-0 opacity-0 translate-y-6' : 'max-h-[420px] opacity-100 translate-y-0'}`}>
                    <div className="rounded-2xl border border-[#AFA3A1]/50 bg-[#E9E8DB] p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#8a8474] mb-2 flex items-center justify-between">
                            <span className="flex items-center gap-1"><IcoSwords className="w-3.5 h-3.5" /> 战况</span>
                            {!done && <span className="animate-pulse"> LIVE</span>}
                        </div>
                        <div ref={logRef} className="space-y-1.5 max-h-44 overflow-y-auto">
                            {(() => {
                                const shown = arena.events.slice(0, eventIdx + 1).filter(e => e.kind !== 'chain').length;
                                const visible = arena.record.rounds.slice(0, Math.max(1, shown));
                                return visible.map((r, i, arr) => {
                                    const m = r.match(/^(第\d+回合：)?(.*)$/);
                                    return (
                                        <div key={i} className={`text-center leading-relaxed font-mono ${i === arr.length - 1 ? 'text-[#3a3a36] font-bold' : 'text-[#6b6963]'}`}>
                                            {m && m[1] ? <span className="text-[9px] opacity-60 mr-1.5">{m[1]}</span> : null}
                                            <span className="text-xs">{m ? m[2] : r}</span>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                        {!intro && ev.kind === 'crit' && <div className="text-center text-base font-black text-[#AFA3A1] animate-fade-in">暴击！-{ev.dmg}</div>}
                        {!intro && ev.kind === 'dodge' && <div className="text-center text-sm font-bold text-[#6b6963] animate-fade-in">闪避！</div>}
                    </div>
                </div>
                {/* 关闭出千：开场选了出千且正在生效才有；user 手动关才停（不关则效果持续到战斗结束） */}
                {!intro && !done && activeCheat && !arena.record.committed && (
                    <button onClick={closeCheat} className="w-full py-2 rounded-xl border border-[#AFA3A1]/70 bg-[#E9E8DB] text-slate-600 text-xs font-bold active:scale-[0.98]">
                        <span className="flex items-center justify-center gap-1.5"><IcoDice className="w-3.5 h-3.5" /> 关闭出千（翻倍效果当场停止，不关则一直生效）</span>
                    </button>
                )}
                {/* 战后感言请求中横幅（文字可在设置里改） */}
                {!intro && narrating && (
                    <div className="rounded-xl border border-[#AFA3A1]/70/60 bg-[#E9E8DB] px-3 py-2 text-center animate-pulse">
                        <span className="text-xs font-bold text-slate-700">{meta.narrationBannerText || NARRATION_BANNER_DEFAULT}</span>
                        <span className="text-[10px] text-slate-500 ml-2">正在请求战后感言…（切走也会继续，回来就能看到）</span>
                    </div>
                )}
                {/* 战后 AI 播报（败方评价 + 胜方回复） */}
                {done && arena.record.narration && (
                    <div className="rounded-2xl border border-[#AFA3A1]/50 bg-[#E9E8DB] p-3 space-y-2">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#8a8474]">战后感言</div>
                        {arena.record.narration.split('\n').map((line, i) => (line.trim() ? (
                            <div key={i} className="text-xs leading-relaxed text-[#3f3d36]">{line}</div>
                        ) : null))}
                    </div>
                )}
                {/* 败者惩罚：转盘（弹窗手点）/ 赌钱（结算时自动），两个模式互不掺和 */}
                {done && arena.record.committed && (meta.punishMode || 'wheel') !== 'off' && (() => {
                    const loserSide: 'a' | 'b' = arena.winner === 'a' ? 'b' : 'a';
                    const loser = loserSide === 'a' ? arena.a : arena.b;
                    const winnerCharId = arena.winner === 'a' ? arena.a.charId : arena.b.charId;
                    const mode = meta.punishMode || 'wheel';
                    return (
                        <div className="rounded-2xl border border-[#AFA3A1]/50 bg-[#E9E8DB] p-3 space-y-2">
                            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#8a8474]">败者惩罚 · {loser.charName}</div>
                            {mode === 'wheel' && !punishResult && (
                                <button onClick={() => { setWheelSpun(null); setWheelRotation(w => w % 360); setWheelModal({ loserCharId: loser.charId, winnerCharId }); }}
                                    className="w-full py-2 rounded-xl border border-[#AFA3A1] bg-[#DAD8C0] text-[#3a3a36] text-xs font-bold active:scale-[0.98]">
                                    <span className="flex items-center justify-center gap-1.5"><IcoTarget className="w-3.5 h-3.5" /> 抽惩罚转盘</span>
                                </button>
                            )}
                            {punishResult && (
                                <div className="text-xs text-[#3f3d36] flex items-center gap-1.5">
                                    {mode === 'wheel' ? <IcoTarget className="w-3.5 h-3.5 shrink-0" /> : <IcoCoin className="w-3.5 h-3.5 shrink-0" />}{punishResult.text}
                                    {punishResult.memSaved && <span className="text-[9px] text-slate-500 ml-1">（已写进 {loser.charId !== 'user' ? loser.charName : charNameOf(winnerCharId) + '（对手替你记着）'} 的记忆）</span>}
                                </div>
                            )}
                        </div>
                    );
                })()}
                {/* 控制 */}
                {done ? (
                    <div className="space-y-2 animate-fade-in">
                        <div className="text-center text-sm font-bold text-slate-600 bg-[#E9E8DB] rounded-xl py-2 flex items-center justify-center gap-1.5">
                            <IcoTrophy className="w-4 h-4 shrink-0" /> {(arena.winner === 'a' ? arena.a.charName : arena.b.charName)} 的 {(arena.winner === 'a' ? arena.a.name : arena.b.name)} 获胜！
                            {arena.record.bet ? `（押注${arena.record.bet.won ? '赢' : '输'} ${arena.record.bet.amount} 金币）` : ''}
                        </div>
                        <button onClick={() => setArena(null)} className="w-full py-2.5 rounded-xl bg-[#E9E8DB] text-slate-600 text-xs font-bold">关闭战斗页面</button>
                    </div>
                ) : (
                    <button onClick={() => { setArenaPhase('battle'); setEventIdx(arena.events.length - 1); }} className="w-full py-2 rounded-xl bg-[#E9E8DB] text-slate-500 text-[10px] font-bold">跳过 ▶▶</button>
                )}
            </div>
        );
    };

    if (!loaded) {
        return <div className="h-full w-full bg-[#F9FBF5] flex items-center justify-center text-sm text-slate-400">宠物对战加载中…</div>;
    }

    return (
        <div className="h-full w-full flex flex-col bg-[#F9FBF5] font-sans relative overflow-hidden">
            {/* 抽卡动画弹窗：点抽签立即出现（不等 API），点背景可跳过 → 结果卡另开一张 */}
            {animScene && (
                <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-6" onClick={() => { setAnimScene(null); setResultModal(cur => cur ?? { pet: animScene.pet }); }}>
                    <div className="bg-white rounded-2xl w-full max-w-sm p-5 relative animate-fade-in" onClick={e => e.stopPropagation()}>
                        {/* 动画区：图片模式（URL，支持 GIF）或盲文多帧轮换（默认三帧数码猫/自定义空行分隔多帧）——纯白底，和结果卡一个色 */}
                        <div className="rounded-xl bg-white border border-[#AFA3A1]/40 flex items-center justify-center h-56 overflow-hidden">
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
                                <div className="rounded-xl bg-white border border-[#AFA3A1]/40 flex items-center justify-center h-56 overflow-hidden mb-3">
                                    <TokenImg value={pet.imageRef} className="max-h-full max-w-full object-contain" />
                                </div>
                            );
                            if (dot.includes('\n')) {
                                const m = dotMeasure(dot);
                                return (
                                    <div className="rounded-xl bg-white border border-[#AFA3A1]/40 flex items-center justify-center h-56 overflow-hidden mb-3">
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
                            {[['hp', IcoHeart, resultModal.pet.hp], ['atk', IcoSwords, resultModal.pet.atk], ['spd', IcoWind, resultModal.pet.stats.spd], ['dodge', IcoDodge, resultModal.pet.stats.dodge], ['crit', IcoBoom, resultModal.pet.stats.crit]].map(([key, Ico, v]) => {
                                const Icon = Ico as React.FC<IconProps>;
                                const val = v as number | string;
                                return (
                                <div key={key as string} className="bg-[#F9FBF5] rounded-lg py-2">
                                    <Icon className="w-3.5 h-3.5 mx-auto text-slate-400" />
                                    <div className="text-sm font-bold text-slate-700">{val}</div>
                                </div>
                                );
                            })}
                        </div>
                        <p className="text-[9px] text-slate-400 mt-2 text-center">归属：{charNameOf(resultModal.pet.ownerId)} · {resultModal.pet.source === 'pool' ? '宠物池命中' : '随机生成'}</p>
                        {/* 十连/批量：其余结果一次列全 */}
                        {batchResults && batchResults.length > 1 && (
                            <div className="mt-3 border-t border-slate-100 pt-2">
                                <div className="text-[10px] font-bold text-slate-500 mb-1.5">本次共抽到 {batchResults.length} 只：</div>
                                <div className="max-h-40 overflow-y-auto space-y-1">
                                    {batchResults.map((p, i) => (
                                        <div key={p.id} className="flex items-center gap-2 bg-[#F9FBF5] rounded-lg px-2 py-1.5">
                                            <span className="text-[9px] text-slate-400 w-4 text-right">{i + 1}.</span>
                                            <PetVisual pet={p} size="w-8 h-8" boxPx={32} />
                                            <span className="text-[11px] font-bold text-slate-700 flex-1 truncate">{p.name}</span>
                                            <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${GRADE_COLORS[p.grade]}`}>{p.grade}·{p.atk}</span>
                                            <span className="text-[9px] text-slate-400">{charNameOf(p.ownerId)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <button onClick={() => { setResultModal(null); setBatchResults(null); }}
                            className="w-full mt-3 py-2.5 rounded-xl bg-[#DAD8C0] text-[#3a3a36] text-sm font-bold active:scale-[0.98]">确定</button>
                    </div>
                </div>
            )}

            {/* 添加抽卡角色（通讯录式选人弹窗）：勾选加入批量抽奖名单 */}
            {gachaAddOpen && (
                <div className="fixed inset-0 z-[210] bg-black/50 flex items-center justify-center p-6" onClick={() => setGachaAddOpen(false)}>
                    <div className="bg-white rounded-2xl w-full max-w-sm p-5 animate-fade-in" onClick={e => e.stopPropagation()}>
                        <div className="text-sm font-bold text-slate-800 mb-3">添加抽卡角色</div>
                        <div className="max-h-72 overflow-y-auto space-y-1.5">
                            {participants.map(p => {
                                const on = gachaMultiIds.has(p.id);
                                return (
                                    <button key={p.id} onClick={() => setGachaMultiIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                        return next;
                                    })}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left ${on ? 'border-[#AFA3A1] bg-[#E9E8DB]' : 'border-[#AFA3A1]/40'}`}>
                                        <TokenImg value={p.avatar} className="w-9 h-9 rounded-full object-cover" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-slate-700 truncate">{p.name}</div>
                                            <div className="text-[9px] text-slate-400">{aliveByChar(p.id).length} 只宠物 · {goldOf(p.id)} 金币</div>
                                        </div>
                                        <span className={`text-[10px] font-bold ${on ? 'text-slate-700' : 'text-slate-300'}`}>{on ? '已选' : '选择'}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setGachaMultiIds(new Set())}
                                className="flex-1 py-2 rounded-xl bg-[#E9E8DB] text-slate-500 text-xs font-bold">全不选</button>
                            <button onClick={() => { setGachaMultiMode(true); setGachaAddOpen(false); addToast(`已选 ${gachaMultiIds.size} 位角色`, 'success'); }}
                                className="flex-1 py-2 rounded-xl bg-[#DAD8C0] text-[#3a3a36] text-xs font-bold">加入抽奖名单</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 出千选择弹窗：开战时 user 参战才弹（选完才真正开打）；点背景=取消整场对战 */}
            {battleIntro && (() => {
                const { a, b, userSide } = battleIntro;
                const me = userSide === 'a' ? a : b;
                const foe = userSide === 'a' ? b : a;
                return (
                    <div className="fixed inset-0 z-[225] bg-black/50 flex items-center justify-center p-6" onClick={() => setBattleIntro(null)}>
                        <div className="w-full max-w-xs rounded-2xl bg-white p-4 space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="text-center space-y-1">
                                <div className="flex items-center justify-center gap-1.5 text-sm font-black text-slate-800"><IcoDice className="w-4 h-4" /> 本场要不要出千？</div>
                                <div className="text-[10px] leading-relaxed text-slate-500">
                                    {me.name} vs {foe.name}。出千成功 = 随机一项属性（暴击/敏捷/闪避）<b>全场翻倍</b>，
                                    不主动关就持续到战斗结束；可能失败或被对方抓包（概率在设置里调）。选中后对战中还能「关闭出千」。
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => startWithCheat(true)} className="py-2.5 rounded-xl bg-[#DAD8C0] text-[#3a3a36] text-xs font-bold active:scale-[0.98] shadow-sm">
                                    出千
                                </button>
                                <button onClick={() => startWithCheat(false)} className="py-2.5 rounded-xl bg-slate-200 text-slate-600 text-xs font-bold active:scale-[0.98]">
                                    正常打
                                </button>
                            </div>
                            <div className="text-center text-[10px] text-slate-400">点弹窗外的空白处 = 放弃本场对战</div>
                        </div>
                    </div>
                );
            })()}

            {/* 惩罚转盘弹窗（圆形转盘）：旋转落定 → 写记忆 → 回应发到私聊（弹窗随时可关） */}
            {wheelModal && (() => {
                const items = wheelItemsActive();
                const loserName = charNameOf(wheelModal.loserCharId);
                const total = items.reduce((s, i) => s + (i.weight || 0), 0) || 1;
                const PALETTE = ['#DAD8C0', '#F9FBF5', '#AFA3A1', '#E9E8DB'];
                let segStart = 0;
                const stops: string[] = [];
                const labels: Array<{ text: string; angle: number }> = [];
                items.forEach((it, i) => {
                    const sweep = (it.weight || 0) / total * 360;
                    stops.push(`${PALETTE[i % PALETTE.length]} ${segStart}deg ${segStart + sweep}deg`);
                    labels.push({ text: it.text, angle: segStart + sweep / 2 });
                    segStart += sweep;
                });
                return (
                    <div className="fixed inset-0 z-[220] bg-black/60 flex items-center justify-center p-6" onClick={() => setWheelModal(null)}>
                        <div className="bg-white rounded-2xl w-full max-w-sm p-5 relative animate-fade-in" onClick={e => e.stopPropagation()}>
                                        <div className="text-sm font-bold text-slate-800 text-center flex items-center justify-center gap-1.5"><IcoTarget className="w-4 h-4" /> 惩罚转盘 · {loserName}</div>
                            {/* 圆形转盘：指针在上，转动后停在落定扇区 */}
                            <div className="relative w-60 h-60 mx-auto mt-3">
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 text-lg">▼</div>
                                <div className="absolute inset-0 rounded-full border-4 border-[#AFA3A1]/40 shadow-inner overflow-hidden"
                                    style={{ background: `conic-gradient(from -90deg, ${stops.join(', ')})`, transform: `rotate(${wheelRotation}deg)`, transition: 'transform 3.2s cubic-bezier(0.15, 0.85, 0.25, 1)' }}>
                                    {labels.map((l, i) => (
                                        <div key={i} className="absolute left-1/2 top-1/2 w-0 h-0">
                                            <div className="absolute text-[9px] font-bold text-slate-700 whitespace-nowrap"
                                                style={{ transform: `rotate(${l.angle}deg) translate(0, -78px) rotate(${-l.angle}deg) translate(-50%, -50%)` }}>
                                                {l.text.length > 9 ? l.text.slice(0, 9) + '…' : l.text}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border-2 border-[#AFA3A1]/40 shadow flex items-center justify-center"><IcoPaw className="w-4 h-4 text-slate-600" /></div>
                            </div>
                            {wheelSpun && (
                                <div className="mt-3 rounded-xl bg-[#E9E8DB] border border-[#AFA3A1]/70 px-3 py-2 text-center">
                                        <div className="text-xs font-bold text-slate-700 flex items-center gap-1"><IcoTarget className="w-3.5 h-3.5 shrink-0" /> {wheelSpun.text}</div>
                                    <div className="text-[9px] text-slate-500 mt-0.5">
                                        已写进 {wheelModal.loserCharId !== 'user' ? loserName : (charNameOf(wheelModal.winnerCharId) + '（对手替你记着这场惩罚）')} 的记忆{wheelModal.loserCharId !== 'user' ? ' · 回应正在发到私聊（可随时关闭本窗口）' : ''}
                                    </div>
                                </div>
                            )}
                            {!wheelSpun && (
                                <button onClick={runWheelSpin} disabled={items.length === 0}
                                    className="w-full mt-3 py-2.5 rounded-xl bg-[#DAD8C0] text-[#3a3a36] text-sm font-bold active:scale-[0.98] disabled:opacity-40">转！</button>
                            )}
                            <button onClick={() => setWheelModal(null)} className={`w-full py-2 rounded-xl bg-[#E9E8DB] text-slate-600 text-xs font-bold ${wheelSpun ? 'mt-2' : 'mt-2'}`}>{wheelSpun ? '关闭（请求后台继续）' : '关闭'}</button>
                        </div>
                    </div>
                );
            })()}

            {/* 宠物池模板管理弹窗（顶栏齿轮打开） */}
            {tplModalOpen && (
                <div className="fixed inset-0 z-[215] bg-black/50 flex items-center justify-center p-6" onClick={() => setTplModalOpen(false)}>
                    <div className="bg-white rounded-2xl w-full max-w-sm p-5 relative animate-fade-in max-h-[85%] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                                        <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><IcoPaw className="w-4 h-4" /> 宠物池模板管理（名字+形象+权重，不绑定角色）</span>
                                        <button onClick={() => setTplModalOpen(false)} className="w-7 h-7 rounded-full bg-[#E9E8DB] text-slate-500 flex items-center justify-center"><IcoX className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="space-y-3">
                            <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="宠物名字" className="w-full px-3 py-2.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none" />
                            <textarea value={tplKaomoji} onChange={e => setTplKaomoji(e.target.value)} placeholder={`颜文字 / 点阵图（不传图片时显示，点阵标准：最多 ${DOT_MAX_LINES} 行 × ${DOT_MAX_COLS} 字/行）`} rows={3}
                                className="w-full px-3 py-2 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-[10px] font-mono outline-none whitespace-pre" />
                            {tplKaomoji.trim() && (() => { const m = dotMeasure(tplKaomoji); const over = m.lines > DOT_MAX_LINES || m.cols > DOT_MAX_COLS; return (
                                <p className={`text-[9px] ${over ? 'text-slate-800 font-bold' : 'text-slate-400'}`}>{m.lines} 行 / 最宽 {m.cols} 字（标准 {DOT_MAX_LINES} 行 × {DOT_MAX_COLS} 字）{over ? ' — 超了，入池会被拦截' : ''}</p>
                            ); })()}
                            <div className="flex items-center gap-2">
                                <button onClick={() => tplFileRef.current?.click()} className="px-3 py-2 rounded-xl bg-[#E9E8DB] text-xs font-bold text-slate-600">插入图片</button>
                                {tplImageRef && <TokenImg value={tplImageRef} className="w-9 h-9 rounded-lg object-cover" />}
                                <input type="file" ref={tplFileRef} className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) handleTplImage(f); e.target.value = ''; }} />
                                <div className="flex items-center gap-1 ml-auto">
                                    <span className="text-[10px] text-slate-400">权重</span>
                                    <input type="number" min={1} value={tplWeight} onChange={e => setTplWeight(parseInt(e.target.value) || 1)} className="w-16 px-2 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none" />
                                </div>
                            </div>
                            <button onClick={handleAddTemplate} className="w-full py-2.5 rounded-xl bg-[#DAD8C0] text-[#3a3a36] text-sm font-bold active:scale-[0.98]">加入池子</button>
                            {templates.length > 0 && (
                                <div className="space-y-2 pt-2 border-t border-slate-100">
                                    {templates.map(t => (
                                        <div key={t.id} className="flex items-center gap-2">
                                            <PetVisual pet={t} size="w-9 h-9" boxPx={36} />
                                            <span className="flex-1 text-xs font-bold text-slate-600 truncate">{t.name}</span>
                                            <span className="text-[9px] text-slate-400">权重 {t.weight}</span>
                                            <button onClick={() => handleDeleteTemplate(t.id)} className="text-[#AFA3A1] hover:text-[#3a3a36] px-1">×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-[9px] text-slate-400">池子概率制永不抽空：命中模板 = 以它的名字形象出新宠物（属性照常重掷）；未命中 = 词库随机生成。</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 设置弹窗（顶栏齿轮：金币 / 抽卡动画 / 提示词 / API / 对战设置） */}
            {settingsOpen && (
                <div className="fixed inset-0 z-[215] bg-black/50 flex items-center justify-center p-6" onClick={() => setSettingsOpen(false)}>
                    <div className="bg-white rounded-2xl w-full max-w-sm p-5 relative animate-fade-in max-h-[85%] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><IcoGear className="w-4 h-4" /> 设置</span>
                            <button onClick={() => setSettingsOpen(false)} className="w-7 h-7 rounded-full bg-[#E9E8DB] text-slate-500 flex items-center justify-center"><IcoX className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="space-y-4">
                            {/* 金币调整 */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">调整每人的金币</label>
                                <div className="space-y-2">
                                    {participants.map(p => (
                                        <div key={p.id} className="flex items-center gap-2">
                                            <TokenImg value={p.avatar} className="w-7 h-7 rounded-full object-cover" />
                                            <span className="text-xs font-bold text-slate-600 flex-1 truncate">{p.name}</span>
                                            <span className="text-xs font-bold text-slate-600 tabular-nums flex items-center gap-0.5"><IcoCoin className="w-3.5 h-3.5" /> {goldOf(p.id)}</span>
                                            <input type="number" onKeyDown={e => {
                                                if (e.key !== 'Enter') return;
                                                const v = parseInt((e.target as HTMLInputElement).value);
                                                if (!isNaN(v)) { setGoldOf(p.id, Math.max(0, goldOf(p.id) + v)); (e.target as HTMLInputElement).value = ''; addToast(`${p.name} 金币 ${v >= 0 ? '+' : ''}${v}`, 'success'); }
                                            }} placeholder="±增减" className="w-20 px-2 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none" />
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[9px] text-slate-400 mt-1">输入正负数回车 = 增减金币。</p>
                            </div>
                            {/* 抽卡动画 */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">抽卡动画</label>
                                <div className="flex gap-1 bg-[#E9E8DB] rounded-lg p-1 mb-2">
                                    {([['braille', '盲文点阵'], ['image', '图片 GIF']] as Array<['braille' | 'image', string]>).map(([id, label]) => (
                                        <button key={id} onClick={async () => { const next = { ...meta, drawAnimMode: id }; setMeta(next); await DB.savePetMeta(next); }}
                                            className={`flex-1 py-1.5 rounded text-[10px] font-bold ${meta.drawAnimMode === id ? 'bg-white shadow text-slate-700' : 'text-slate-400'}`}>{label}</button>
                                    ))}
                                </div>
                                {meta.drawAnimMode === 'image' && (
                                    <input value={meta.drawAnimUrl || ''} onChange={async e => { const next = { ...meta, drawAnimUrl: e.target.value.trim() || undefined }; setMeta(next); await DB.savePetMeta(next); }} placeholder="图片 URL（支持 GIF）" className="w-full px-3 py-2.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none" />
                                )}
                                {meta.drawAnimMode === 'braille' && (() => {
                                    const boxes = frameBoxes ?? (meta.drawAnimBraille && meta.drawAnimBraille.trim() ? meta.drawAnimBraille.replace(/\r/g, '').split(/\n\s*\n/) : ['']);
                                    const validFrames = parseAnimFrames(meta.drawAnimBraille);
                                    const editFrame = async (i: number, v: string) => {
                                        const next = boxes.map((b, bi) => bi === i ? v : b);
                                        setFrameBoxes(next);
                                        const joined = next.map(f => f.trim()).filter(f => f).join('\n\n') || undefined;
                                        const m = { ...meta, drawAnimBraille: joined };
                                        setMeta(m);
                                        await DB.savePetMeta(m);
                                    };
                                    return (
                                        <div className="space-y-2">
                                            <p className="text-[9px] text-slate-400">每一帧一个框（和宠物点阵同一个标准：≤ {DOT_MAX_LINES} 行 × {DOT_MAX_COLS} 字），轮换播放；留空 = 默认数码猫三帧。</p>
                                            {boxes.map((b, i) => (
                                                <div key={i} className="relative">
                                                    <div className="text-[9px] font-bold text-slate-400 mb-0.5">第 {i + 1} 帧</div>
                                                    <textarea value={b} onChange={e => editFrame(i, e.target.value)} rows={4}
                                                        placeholder={`第 ${i + 1} 帧点阵（≤ ${DOT_MAX_LINES} 行 × ${DOT_MAX_COLS} 字）`}
                                                        className="w-full px-3 py-2 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-[10px] font-mono outline-none whitespace-pre" />
                                                    {boxes.length > 1 && (
                                                        <button onClick={() => { const next = boxes.filter((_, bi) => bi !== i); setFrameBoxes(next); const joined = next.map(f => f.trim()).filter(f => f).join('\n\n') || undefined; const m = { ...meta, drawAnimBraille: joined }; setMeta(m); DB.savePetMeta(m); }}
                                                            className="absolute top-0 right-0 p-1 text-slate-400"><IcoX className="w-3 h-3" /></button>
                                                    )}
                                                </div>
                                            ))}
                                            <button onClick={() => setFrameBoxes([...boxes, ''])}
                                                className="w-full py-1.5 rounded-lg border border-dashed border-[#AFA3A1]/70 text-slate-400 text-[10px] font-bold flex items-center justify-center gap-1"><IcoPlus className="w-3 h-3" /> 加一帧</button>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-slate-400">当前 <b className="text-slate-600">{validFrames.length}</b> 帧参与轮换</span>
                                                <span className="text-[10px] text-slate-400 ml-auto">每帧</span>
                                                <input type="number" min={60} step={20} value={meta.drawAnimInterval || DIG_INTERVAL_DEFAULT}
                                                    onChange={async e => { const v = Math.max(60, parseInt(e.target.value) || DIG_INTERVAL_DEFAULT); const next = { ...meta, drawAnimInterval: v }; setMeta(next); await DB.savePetMeta(next); }}
                                                    className="w-20 px-2 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none tabular-nums" />
                                                <span className="text-[10px] text-slate-400">毫秒</span>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                            {/* API 设置：抽卡 / 战报各自选预设，不设 = 主聊天 API */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">API 设置（独立于群聊/私聊）</label>
                                {([['gacha', '抽卡评价 API'], ['battle', '战报播报 API']] as Array<['gacha' | 'battle', string]>).map(([purpose, label]) => {
                                    const key = purpose === 'gacha' ? 'apiPresetIdGacha' : 'apiPresetIdBattle' as const;
                                    return (
                                    <div key={purpose} className="mb-2">
                                        <div className="text-[10px] font-bold text-slate-500 mb-1">{label}</div>
                                        <select value={meta[key] || ''}
                                            onChange={async e => { const next = { ...meta, [key]: e.target.value || undefined }; setMeta(next); await DB.savePetMeta(next); }}
                                            className="w-full px-3 py-2.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none">
                                            <option value="">不设置（用主聊天 API）</option>
                                            {apiPresets.map(ps => <option key={ps.id} value={ps.id}>{ps.name}（{ps.config.model || '默认模型'}）</option>)}
                                        </select>
                                        <p className="text-[9px] text-slate-400 mt-0.5">从预设列表选择；战报/抽卡互不影响。</p>
                                    </div>
                                    );
                                })}
                            </div>
                            {/* 提示词发送顺序可视化 + 编辑 */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">提示词（按发送顺序可视化）</label>
                                <div className="space-y-1.5 text-[11px] font-bold">
                                    <div className="rounded-lg bg-[#F9FBF5] border border-[#AFA3A1]/40 px-3 py-2 text-slate-500">世界书 + 过往记忆 + 角色人设 <span className="font-normal text-slate-400">（自动带入，无需编辑）</span></div>
                                    <div className="text-center text-slate-300">↓</div>
                                    <div className="flex gap-1.5">
                                        <button onClick={() => setPromptTab('gacha')} className={`flex-1 py-2 rounded-lg border text-[11px] ${promptTab === 'gacha' ? 'border-[#AFA3A1] bg-[#E9E8DB] text-[#3a3a36]' : 'border-[#AFA3A1]/40 text-slate-500'}`}>抽卡提示词</button>
                                        <button onClick={() => setPromptTab('battle')} className={`flex-1 py-2 rounded-lg border text-[11px] ${promptTab === 'battle' ? 'border-[#AFA3A1] bg-[#E9E8DB] text-[#3a3a36]' : 'border-[#AFA3A1]/40 text-slate-500'}`}>战报提示词</button>
                                    </div>
                                    {promptTab === 'gacha' ? (
                                        <div className="space-y-1.5">
                                            <textarea value={meta.promptGacha || PROMPT_GACHA_DEFAULT} onChange={async e => { const next = { ...meta, promptGacha: e.target.value }; setMeta(next); await DB.savePetMeta(next); }} rows={6}
                                                className="w-full px-3 py-2 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-[10px] font-mono outline-none" />
                                            <button onClick={async () => { const next = { ...meta, promptGacha: undefined }; setMeta(next); await DB.savePetMeta(next); addToast('已恢复默认抽卡评价模板', 'success'); }} className="text-[9px] text-slate-500 flex items-center gap-1"><IcoReset className="w-3 h-3" /> 恢复默认</button>
                                            <p className="text-[9px] text-slate-400 leading-tight">占位符自动替换：{'{人设}{名字}{品级}{攻击}{敏捷}{闪避}{暴击}{血量}'}</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            <textarea value={meta.promptBattle || PROMPT_BATTLE_DEFAULT} onChange={async e => { const next = { ...meta, promptBattle: e.target.value }; setMeta(next); await DB.savePetMeta(next); }} rows={8}
                                                className="w-full px-3 py-2 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-[10px] font-mono outline-none" />
                                            <button onClick={async () => { const next = { ...meta, promptBattle: undefined }; setMeta(next); await DB.savePetMeta(next); addToast('已恢复默认战报模板', 'success'); }} className="text-[9px] text-slate-500 flex items-center gap-1"><IcoReset className="w-3 h-3" /> 恢复默认</button>
                                            <p className="text-[9px] text-slate-400 leading-tight">占位符自动替换：{'{A人设}{B人设}{A主人}{B主人}{A名}{B名}{A宠物}{B宠物}{脚本战报}{胜者}'} 等</p>
                                        </div>
                                    )}
                                    <div className="text-center text-slate-300">↓</div>
                                    <div className="flex gap-1.5">
                                        <button onClick={() => setPromptTab('punish')} className={`flex-1 py-2 rounded-lg border text-[11px] ${promptTab === 'punish' ? 'border-[#AFA3A1] bg-[#E9E8DB] text-[#3a3a36]' : 'border-[#AFA3A1]/40 text-slate-500'}`}>轮盘惩罚提示词</button>
                                        <button onClick={() => setPromptTab('bet')} className={`flex-1 py-2 rounded-lg border text-[11px] ${promptTab === 'bet' ? 'border-[#AFA3A1] bg-[#E9E8DB] text-[#3a3a36]' : 'border-[#AFA3A1]/40 text-slate-500'}`}>赌钱压金提示词</button>
                                    </div>
                                    {promptTab === 'punish' && (
                                        <div className="space-y-1.5">
                                            <p className="text-[9px] text-slate-400 leading-tight">转盘抽中惩罚后发给败者角色让他回应。占位符：{'{人设}{惩罚}{赢家}'}</p>
                                            <textarea value={meta.promptPunish || PROMPT_PUNISH_DEFAULT} onChange={async e => { const next = { ...meta, promptPunish: e.target.value }; setMeta(next); await DB.savePetMeta(next); }} rows={6}
                                                className="w-full px-3 py-2 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-[10px] font-mono outline-none" />
                                            <button onClick={async () => { const next = { ...meta, promptPunish: undefined }; setMeta(next); await DB.savePetMeta(next); addToast('已恢复默认惩罚提示词', 'success'); }} className="text-[9px] text-slate-500 flex items-center gap-1"><IcoReset className="w-3 h-3" /> 恢复默认</button>
                                        </div>
                                    )}
                                    {promptTab === 'bet' && (
                                        <div className="space-y-1.5">
                                            <p className="text-[9px] text-slate-400 leading-tight">赌钱模式开战前发给双方角色让他们先放话。占位符：{'{A人设}{B人设}{A主人}{B主人}{金额}{A宠物}{B宠物}'}</p>
                                            <textarea value={meta.promptBetStake || PROMPT_BET_STAKE_DEFAULT} onChange={async e => { const next = { ...meta, promptBetStake: e.target.value }; setMeta(next); await DB.savePetMeta(next); }} rows={6}
                                                className="w-full px-3 py-2 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-[10px] font-mono outline-none" />
                                            <button onClick={async () => { const next = { ...meta, promptBetStake: undefined }; setMeta(next); await DB.savePetMeta(next); addToast('已恢复默认压金提示词', 'success'); }} className="text-[9px] text-slate-500 flex items-center gap-1"><IcoReset className="w-3 h-3" /> 恢复默认</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* 对战设置 */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">对战设置</label>
                                {/* 战后发言模式：导演 / 轮调（和群聊一个逻辑） */}
                                <div className="text-[10px] font-bold text-slate-500 mb-1">战后感言模式</div>
                                <div className="flex gap-1 bg-[#E9E8DB] rounded-lg p-1 mb-2">
                                    {([['director', '导演模式'], ['roundRobin', '轮调模式']] as Array<['director' | 'roundRobin', string]>).map(([id, label]) => (
                                        <button key={id} onClick={async () => { const next = { ...meta, battleReplyMode: id }; setMeta(next); await DB.savePetMeta(next); }}
                                            className={`flex-1 py-1.5 rounded text-[10px] font-bold ${(meta.battleReplyMode || 'director') === id ? 'bg-white shadow text-slate-700' : 'text-slate-400'}`}>{label}</button>
                                    ))}
                                </div>
                                <p className="text-[9px] text-slate-400 mb-2 leading-tight">导演 = 一次 API 直接写整段感言；轮调 = 败者、胜者各自单独调用一次 API 轮流发言。</p>
                                {/* 出千概率 */}
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-[10px] text-slate-400 w-14">出千成功率</span>
                                    <input type="number" min={0} max={100} value={meta.cheatSuccessRate ?? 65}
                                        onChange={async e => { const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)); const next = { ...meta, cheatSuccessRate: v }; setMeta(next); await DB.savePetMeta(next); }}
                                        className="w-20 px-2 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none tabular-nums" />
                                    <span className="text-[10px] text-slate-400 ml-2 w-14">被抓住率</span>
                                    <input type="number" min={0} max={100} value={meta.cheatCaughtRate ?? 35}
                                        onChange={async e => { const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)); const next = { ...meta, cheatCaughtRate: v }; setMeta(next); await DB.savePetMeta(next); }}
                                        className="w-20 px-2 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none tabular-nums" />
                                    <span className="text-[10px] text-slate-400">%</span>
                                </div>
                                <p className="text-[9px] text-slate-400">成功且没被抓 → 下一回合起随机 暴击/敏捷/闪避 翻倍 2 回合；成功但被抓 → 翻倍取消；失败 → 无事发生。都会写进战况。</p>
                            </div>
                            {/* 败者惩罚 */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">败者惩罚</label>
                                <p className="text-[9px] text-slate-400 mb-2">模式在顶栏切换：点 <b>金币</b> 切到赌钱模式，点 <b>轮盘图标</b> 切到转盘模式。</p>
                                <button onClick={async () => { const next = { ...meta, punishMode: (meta.punishMode || 'wheel') === 'off' ? 'wheel' as const : 'off' as const }; setMeta(next); await DB.savePetMeta(next); }}
                                    className={`w-full py-1.5 rounded-lg text-[10px] font-bold border ${meta.punishMode === 'off' ? 'border-[#AFA3A1]/70 text-slate-400' : 'border-[#AFA3A1]/70 text-slate-500'}`}>
                                    {meta.punishMode === 'off' ? '惩罚已关闭（点击启用）' : '关闭惩罚'}
                                </button>
                                {(meta.punishMode || 'wheel') === 'wheel' && (() => {
                                    const items = meta.wheelItems ?? WHEEL_ITEMS_DEFAULT;
                                    const saveItems = async (next: typeof items) => { const m = { ...meta, wheelItems: next }; setMeta(m); await DB.savePetMeta(m); };
                                    return (
                                        <div className="space-y-1.5">
                                            {items.map((it, idx) => (
                                                <div key={it.id || idx} className="flex items-center gap-1.5">
                                                    <input value={it.text} onChange={e => { const next = items.map((x, i) => i === idx ? { ...x, text: e.target.value } : x); saveItems(next); }}
                                                        placeholder="惩罚内容" className="flex-1 min-w-0 px-2 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none" />
                                                    <input type="number" min={1} value={it.weight} onChange={e => { const next = items.map((x, i) => i === idx ? { ...x, weight: Math.max(1, parseInt(e.target.value) || 1) } : x); saveItems(next); }}
                                                        className="w-14 px-1.5 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none tabular-nums" />
                                                    <button onClick={() => saveItems(items.filter((_, i) => i !== idx))} className="p-1 text-slate-400"><IcoX className="w-3 h-3" /></button>
                                                </div>
                                            ))}
                                            <button onClick={() => saveItems([...items, { id: `w-${Date.now()}`, text: '', weight: 10 }])}
                                                className="w-full py-1.5 rounded-lg border border-dashed border-[#AFA3A1]/70 text-slate-400 text-[10px] font-bold flex items-center justify-center gap-1"><IcoPlus className="w-3 h-3" /> 加一条（内容 / 权重）</button>
                                            <p className="text-[9px] text-slate-400">抽中的惩罚会自动写进败者的记忆。留空或权重 ≤0 的条目不参与。</p>
                                        </div>
                                    );
                                })()}
                                {(meta.punishMode || 'wheel') === 'bet' && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-400">败者赔给赢家</span>
                                        <input type="number" min={1} value={meta.punishBetAmount ?? 100}
                                            onChange={async e => { const v = Math.max(1, parseInt(e.target.value) || 100); const next = { ...meta, punishBetAmount: v }; setMeta(next); await DB.savePetMeta(next); }}
                                            className="w-24 px-2 py-1.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-lg text-xs outline-none tabular-nums" />
                                        <span className="text-[10px] text-slate-400">金币（结算时自动转账并记入双方记忆）</span>
                                    </div>
                                )}
                            </div>
                            {/* 战后感言横幅 */}
                            <div className="pt-2 border-t border-slate-100">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">战后感言请求横幅文字</label>
                                <input value={meta.narrationBannerText ?? NARRATION_BANNER_DEFAULT}
                                    onChange={async e => { const next = { ...meta, narrationBannerText: e.target.value.trim() || undefined }; setMeta(next); await DB.savePetMeta(next); }}
                                    className="w-full px-3 py-2.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none" />
                                <p className="text-[9px] text-slate-400 mt-1">感言生成需要十几秒，期间对战页面顶部会滚动显示这句话。</p>
                            </div>
                            {/* 报错记录：弹窗 10 秒自动消失，过往报错都在这里 */}
                            <div className="pt-2 border-t border-slate-100">
                                <details>
                                    <summary className="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer">报错记录（最近 50 条）</summary>
                                    <div className="mt-2 space-y-1.5">
                                        {(() => {
                                            try {
                                                const hist: Array<{ title: string; details: string; at: number }> = JSON.parse(localStorage.getItem('petpvp-error-history') || '[]');
                                                if (!hist.length) return <p className="text-[10px] text-slate-400">没有报错记录。</p>;
                                                return hist.map((h, i) => (
                                                    <details key={i} className="bg-[#F9FBF5] rounded-lg border border-[#AFA3A1]/40">
                                                        <summary className="px-2.5 py-1.5 text-[10px] font-bold text-slate-600 cursor-pointer flex items-center gap-1.5">
                                                            <span className="text-slate-600 shrink-0">{h.title}</span>
                                                            <span className="text-slate-400 font-normal ml-auto shrink-0">{new Date(h.at).toLocaleString('zh-CN')}</span>
                                                        </summary>
                                                        <pre className="px-2.5 pb-2 text-[9px] text-slate-500 whitespace-pre-wrap break-words font-mono">{h.details}</pre>
                                                    </details>
                                                ));
                                            } catch { return <p className="text-[10px] text-slate-400">没有报错记录。</p>; }
                                        })()}
                                        <button onClick={() => { try { localStorage.removeItem('petpvp-error-history'); addToast('已清空报错记录', 'success'); } catch { /* ignore */ } }}
                                            className="w-full py-1.5 rounded-lg border border-[#AFA3A1]/70 text-slate-500 text-[10px] font-bold flex items-center justify-center gap-1"><IcoTrash className="w-3 h-3" /> 清空报错记录</button>
                                    </div>
                                </details>
                                <p className="text-[9px] text-slate-400 mt-1">报错弹窗 10 秒没人点会自动消失，记录在这里保留（最多 50 条）。</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 顶栏 */}
            <div className="shrink-0 z-10 sticky top-0 bg-white/80 backdrop-blur-md border-b border-[#AFA3A1]/40/60" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="pt-12 pb-3 px-4 flex items-center justify-between">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform"><IcoBack className="w-4 h-4 text-slate-600" /></button>
                    <span className="font-bold text-slate-700 flex items-center gap-1.5"><IcoPaw className="w-4 h-4" /> 宠物对战</span>
                    <div className="flex items-center gap-1.5">
                        {tab === 'gacha' || (meta.punishMode || 'wheel') !== 'wheel' ? (
                            <button onClick={togglePunishMode} title="点击切换惩罚模式：金币=赌钱，轮盘=转盘"
                                className="text-xs font-bold text-slate-600 bg-[#E9E8DB] px-2.5 py-1 rounded-full active:scale-95 flex items-center gap-1">
                                <IcoCoin className="w-3.5 h-3.5" /> {tab === 'gacha' ? goldOf(gachaCharId || 'user') : goldOf('user')}
                            </button>
                        ) : (
                            <button onClick={togglePunishMode} title="轮盘惩罚模式中（点击切回赌钱模式）"
                                className="bg-[#E9E8DB] px-2.5 py-1 rounded-full active:scale-95"><IcoTarget className="w-3.5 h-3.5 text-slate-500" /></button>
                        )}
                        <button onClick={() => setTplModalOpen(true)} title="宠物池模板管理"
                            className="w-7 h-7 rounded-full bg-[#E9E8DB] text-slate-500 flex items-center justify-center active:scale-90"><IcoDice className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setSettingsOpen(true)} title="设置（金币 / 抽卡动画 / 提示词 / API）"
                            className="w-7 h-7 rounded-full bg-[#E9E8DB] text-slate-500 flex items-center justify-center active:scale-90"><IcoGear className="w-3.5 h-3.5" /></button>
                    </div>
                </div>
                {/* Tabs */}
                <div className="flex gap-1 px-4 pb-2">
                    {([['gacha', '抽奖'], ['pets', '宠物列表'], ['battle', '对战'], ['stats', '战绩']] as Array<[Tab, string]>).map(([id, label]) => (
                        <button key={id} onClick={() => setTab(id as Tab)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === id ? 'bg-[#DAD8C0] text-[#3a3a36] shadow' : 'bg-[#E9E8DB] text-[#6b6963]'}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
                {/* ─── 抽奖 ─── */}
                {tab === 'gacha' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-4 border border-[#AFA3A1]/40/70">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">谁去抽奖（你也能抽）</label>
                                <button onClick={() => setGachaMultiMode(m => !m)}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${gachaMultiMode ? 'border-[#AFA3A1] bg-[#E9E8DB] text-[#3a3a36]' : 'border-[#AFA3A1]/40 text-slate-400'}`}>
                                        {gachaMultiMode ? <span className="flex items-center justify-center gap-1">批量模式 <IcoCheck className="w-3 h-3" /></span> : '批量模式'}
                                </button>
                            </div>
                            {!gachaMultiMode ? (
                                <select value={gachaCharId} onChange={e => setGachaCharId(e.target.value)} className="w-full px-3 py-2.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none">
                                    {participants.map(p => {
                                        const owned = aliveByChar(p.id).length > 0;
                                        return <option key={p.id} value={p.id}>{p.name}{owned ? `（默认出战：${defaultPetOf(p.id)?.name || '无'}）` : ''}</option>;
                                    })}
                                </select>
                            ) : (
                                <div className="flex flex-wrap gap-2 mb-1">
                                    {participants.map(p => {
                                        const on = gachaMultiIds.has(p.id);
                                        return (
                                            <button key={p.id} onClick={() => setGachaMultiIds(prev => {
                                                const next = new Set(prev);
                                                if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                                return next;
                                            })}
                                                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full border text-[11px] font-bold ${on ? 'border-[#AFA3A1] bg-[#E9E8DB] text-[#3a3a36]' : 'border-[#AFA3A1]/40 text-slate-500'}`}>
                                                <TokenImg value={p.avatar} className="w-5 h-5 rounded-full object-cover" />
                                                {p.name}{on && <IcoCheck className="w-3 h-3" />}
                                            </button>
                                        );
                                    })}
                                    <p className="w-full text-[9px] text-slate-400">批量模式：勾选的每位角色一起抽（每人各扣一份金币）。不勾人 = 没人抽。</p>
                                </div>
                            )}
                            <button onClick={() => { setGachaAddOpen(true); }}
                                className="w-full mt-2 py-1.5 rounded-lg border border-dashed border-[#AFA3A1]/70 text-slate-400 text-[10px] font-bold">＋ 添加抽卡角色（通讯录选人，可多选）</button>
                            <div className="flex gap-2 mt-3">
                                <button onClick={() => doGacha(1)} disabled={drawing}
                                    className={`flex-1 py-3 rounded-2xl font-bold text-white text-sm transition-all ${drawing ? 'bg-slate-300' : 'bg-[#DAD8C0] text-[#3a3a36] active:scale-[0.98]'}`}>
                                    单抽（{GACHA_COST} 金币{gachaMultiMode ? '/人' : ''}）
                                </button>
                                <button onClick={() => doGacha(10)} disabled={drawing}
                                    className={`flex-1 py-3 rounded-2xl font-bold text-white text-sm transition-all ${drawing ? 'bg-slate-300' : 'bg-[#DAD8C0] text-[#3a3a36] active:scale-[0.98]'}`}>
                                    十连抽（{GACHA_COST * 10} 金币{gachaMultiMode ? '/人' : ''}）
                                </button>
                            </div>
                            <p className="text-[9px] text-slate-400 mt-2">品级：A(6%) B(12%) C(22%) D(30%) E(30%)；角色抽卡会调一次 AI 用角色口吻评价（批量多人只评代表）；十连的动画只播一次、结果卡一次列全；宠物死亡后可重新抽奖。</p>
                        </div>
                        {lastRolled && (
                            <div className="bg-white rounded-2xl p-4 border border-[#AFA3A1]/40/70 animate-fade-in">
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
                                    {[['hp', IcoHeart, '血量', lastRolled.hp], ['atk', IcoSwords, '攻击', lastRolled.atk], ['spd', IcoWind, '敏捷', lastRolled.stats.spd], ['dodge', IcoDodge, '闪避', lastRolled.stats.dodge], ['crit', IcoBoom, '暴击', lastRolled.stats.crit]].map(([key, Ico, name, v]) => {
                                        const Icon = Ico as React.FC<IconProps>;
                                        const label = name as string;
                                        const val = v as number | string;
                                        return (
                                        <div key={key as string} className="bg-[#F9FBF5] rounded-lg py-2">
                                            <Icon className="w-3.5 h-3.5 mx-auto text-slate-400" />
                                            <div className="text-[9px] text-slate-400 mt-0.5">{label}</div>
                                            <div className="text-sm font-bold text-slate-700">{val}</div>
                                        </div>
                                        );
                                    })}
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
                                <details key={row.id} className="bg-white rounded-2xl border border-[#AFA3A1]/40/70 overflow-hidden">
                                    <summary className="flex items-center gap-3 p-3 cursor-pointer">
                                        <TokenImg value={row.avatar} className="w-10 h-10 rounded-full object-cover" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-slate-700 truncate">{row.name}</div>
                                            <div className="text-[10px] text-slate-400 flex items-center gap-1">{row.petCount} 只宠物 · <IcoCoin className="w-3 h-3" /> {row.gold}</div>
                                        </div>
                                        <span className="text-slate-300">▸</span>
                                    </summary>
                                    <div className="px-3 pb-3 space-y-2">
                                        {aliveByChar(row.id).length === 0 && <div className="text-[11px] text-slate-400 py-2">还没有宠物，去抽奖吧</div>}
                                        {aliveByChar(row.id).slice().sort((a, b) => a.createdAt - b.createdAt).map(pet => {
                                            const isDefault = defaultPetOf(row.id)?.id === pet.id;
                                            return (
                                                <div key={pet.id} className={`bg-[#F9FBF5] rounded-xl p-2.5 flex items-center gap-2.5 ${isDefault ? 'ring-1 ring-[#AFA3A1]' : ''}`}>
                                                    <PetVisual pet={pet} size="w-10 h-10" boxPx={40} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-bold text-slate-700 truncate">
                                                            {pet.name}
                                                            <span className={`ml-1 text-[9px] font-bold px-1 py-0.5 rounded border ${GRADE_COLORS[pet.grade]}`}>{pet.grade}</span>
                                                            {isDefault && <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-[#DAD8C0] text-[#3a3a36]">默认出战</span>}
                                                        </div>
                                                        <div className="text-[9px] text-slate-400 flex items-center gap-1.5">
                                                            <span className="flex items-center gap-0.5"><IcoHeart className="w-2.5 h-2.5" />{pet.hp}</span>
                                                            <span className="flex items-center gap-0.5"><IcoSwords className="w-2.5 h-2.5" />{pet.atk}</span>
                                                            <span className="flex items-center gap-0.5"><IcoWind className="w-2.5 h-2.5" />{pet.stats.spd}</span>
                                                            <span className="flex items-center gap-0.5"><IcoDodge className="w-2.5 h-2.5" />{pet.stats.dodge}</span>
                                                            <span className="flex items-center gap-0.5"><IcoBoom className="w-2.5 h-2.5" />{pet.stats.crit}</span>
                                                        </div>
                                                    </div>
                                                    {!isDefault && (
                                                        <button onClick={async () => { await setDefaultPet(row.id, pet.id); addToast(`${row.name} 的默认出战改为「${pet.name}」`, 'success'); }}
                                                            className="shrink-0 px-2 py-1 rounded-lg bg-white border border-[#AFA3A1]/40 text-[9px] font-bold text-slate-500 active:scale-95">设为默认</button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        <p className="text-[9px] text-slate-400 px-1">对战时脚本自动选各自最高品级的宠物出阵；同品级有多只时优先「默认出战」那只，它阵亡后按抽取顺序自动顺延。</p>
                                    </div>
                                </details>
                            ));
                        })()}
                    </div>
                )}

                {/* ─── 对战 ─── */}
                {tab === 'battle' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-4 border border-[#AFA3A1]/40/70 space-y-3">
                            <div className="flex gap-1 bg-[#E9E8DB] rounded-lg p-1">
                                {([['avb', 'A vs B'], ['avs', 'A vs 随机'], ['rvr', '随机 vs 随机']] as Array<[typeof mode, string]>).map(([id, label]) => (
                                    <button key={id} onClick={() => setMode(id)} className={`flex-1 py-1.5 rounded text-[10px] font-bold ${mode === id ? 'bg-white shadow text-slate-700' : 'text-slate-400'}`}>{label}</button>
                                ))}
                            </div>
                            {/* 对阵标注（出战=各自最高品级宠物，脚本自动同级匹配） */}
                            {mode === 'rvr' ? (
                                            <p className="text-[11px] font-bold text-slate-500 text-center bg-[#F9FBF5] rounded-xl py-2 flex items-center justify-center gap-1.5"><IcoDice className="w-3.5 h-3.5" /> 脚本将随机匹配两位有宠物的角色</p>
                            ) : (
                                <p className="text-[11px] font-bold text-slate-600 text-center bg-[#F9FBF5] rounded-xl py-2">
                                    A方 {sideAChar ? `${charNameOf(sideAChar)}·${gradePickPet(sideAChar)?.name || '无'}` : '自动'} VS B方 {mode === 'avb' && sideBChar ? `${charNameOf(sideBChar)}·${gradePickPet(sideBChar)?.name || '无'}` : '自动'}
                                    <span className="ml-1.5 text-[9px] font-normal text-slate-400">（出战=各自最高品级，尽量同级对打）</span>
                                </p>
                            )}
                            {mode !== 'rvr' && (
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">A 方角色（只能选有活宠物的）</label>
                                    <select value={sideAChar} onChange={e => setSideAChar(e.target.value)} className="w-full px-3 py-2.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none">
                                        <option value="">自动选择…</option>
                                        {participants.filter(p => aliveByChar(p.id).length > 0).map(p => <option key={p.id} value={p.id}>{p.name}（出战：{gradePickPet(p.id)?.name || '无'}）</option>)}
                                    </select>
                                </div>
                            )}
                            {mode === 'avb' && (
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">B 方角色</label>
                                    <select value={sideBChar} onChange={e => setSideBChar(e.target.value)} className="w-full px-3 py-2.5 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none">
                                        <option value="">选择对手…</option>
                                        {participants.filter(p => p.id !== sideAChar && aliveByChar(p.id).length > 0).map(p => <option key={p.id} value={p.id}>{p.name}（出战：{gradePickPet(p.id)?.name || '无'}）</option>)}
                                    </select>
                                </div>
                            )}
                            {/* 押注：仅赌钱模式（轮盘模式不涉及金币押注） */}
                            {(meta.punishMode || 'wheel') === 'bet' && (
                                <div className="pt-2 border-t border-slate-100">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">押注（可选）</label>
                                    <div className="flex gap-2 items-center">
                                        {(['a', 'b', null] as Array<'a' | 'b' | null>).map(s => (
                                            <button key={String(s)} onClick={() => setBetSide(s)}
                                                className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${betSide === s ? 'border-[#AFA3A1] bg-[#E9E8DB] text-[#3a3a36]' : 'border-[#AFA3A1]/40 text-slate-500'}`}>
                                                {s === 'a' ? '押 A 赢' : s === 'b' ? (mode === 'avb' ? '押 B 赢' : '押对手赢') : '不押注'}
                                            </button>
                                        ))}
                                    </div>
                                    {betSide && (
                                        <input type="number" min={1} value={betAmount} onChange={e => setBetAmount(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="w-full mt-2 px-3 py-2 bg-[#F9FBF5] border border-[#AFA3A1]/40 rounded-xl text-sm outline-none" />
                                    )}
                                    <p className="text-[9px] text-slate-400 mt-1">赔率由脚本预演 200 局的胜率决定（冷门赔得高），开战后自动结算。</p>
                                </div>
                            )}
                            <button onClick={startBattle} disabled={battling}
                                className={`w-full py-3 rounded-2xl font-bold transition-all ${battling ? 'bg-slate-300 text-slate-500' : 'bg-[#DAD8C0] text-[#3a3a36] active:scale-[0.98]'}`}>
                                {battling ? '战斗结算中…' : mode === 'rvr'
                                    ? <span className="flex items-center justify-center gap-1.5"><IcoDice className="w-4 h-4" /> 随机匹配</span>
                                    : <span className="flex items-center justify-center gap-1.5"><IcoSwords className="w-4 h-4" /> 开始对战</span>}
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
                                        <div key={charId} className="bg-white rounded-2xl p-4 border border-[#AFA3A1]/40/70 flex items-center gap-3">
                                            <TokenImg value={charAvatarOf(charId)} className="w-10 h-10 rounded-full object-cover" />
                                            <div className="flex-1">
                                                <div className="text-sm font-bold text-slate-700">{charNameOf(charId)}</div>
                                                <div className="text-[10px] text-slate-400">总场次 {s.win + s.lose}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-slate-800 font-bold text-sm">{s.win} 胜</div>
                                                <div className="text-slate-400 font-bold text-sm">{s.lose} 负</div>
                                            </div>
                                        </div>
                                    ))}
                                    {battles.length > 0 && (() => {
                                        const recent = battles.slice().sort((x, y) => y.createdAt - x.createdAt).slice(0, 10);
                                        return (
                                            <div className="space-y-2 pt-2">
                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">最近战报（含感言/惩罚）</div>
                                                {recent.map(b => (
                                                    <details key={b.id} className="bg-white rounded-2xl border border-[#AFA3A1]/40/70 overflow-hidden">
                                                        <summary className="px-3 py-2.5 cursor-pointer flex items-center gap-2">
                                                            <span className="text-xs font-bold text-slate-700 flex-1 truncate">
                                                                {charNameOf(b.aCharId)}「{b.aName}」 vs {charNameOf(b.bCharId)}「{b.bName}」
                                                            </span>
                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#E9E8DB] text-slate-500 shrink-0 flex items-center gap-0.5">
                                                                <IcoTrophy className="w-3 h-3" /> {charNameOf(b.winnerCharId)}
                                                            </span>
                                                        </summary>
                                                        <div className="px-3 pb-3 space-y-1.5">
                                                            {b.narration
                                                                ? b.narration.split('\n').map((line, i) => (line.trim() ? <div key={i} className="text-[11px] leading-relaxed text-slate-600">{line}</div> : null))
                                                                : <div className="text-[10px] text-slate-400">（这场没有生成感言）</div>}
                                                        </div>
                                                    </details>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                    {/* 重置：宠物+战报+金币+默认出战全清（角色记忆和宠物池模板、提示词等设置保留） */}
                                    <button onClick={() => {
                                        if (!window.confirm('重置宠物对战？\n\n会清掉：全部宠物（保留宠物池模板）、全部战报战绩、所有角色金币恢复 1000、默认出战表。\n不会动：角色记忆、宠物池模板、提示词/动画/概率等设置。\n\n确定重置吗？')) return;
                                        (async () => {
                                            await DB.clearAllPets(true);
                                            for (const b of battles) await DB.deletePetBattle(b.id);
                                            await DB.savePetMeta({ ...meta, goldByChar: {}, defaultPetByChar: {} });
                                            setPets(await DB.getAllPets());
                                            setBattles([]);
                                            setMeta({ ...meta, goldByChar: {}, defaultPetByChar: {} });
                                            addToast('宠物对战已重置（金币恢复默认，记忆和模板保留）', 'success');
                                        })();
                                    }}
                                        className="w-full py-2.5 rounded-xl border border-[#AFA3A1]/70 text-slate-500 text-xs font-bold flex items-center justify-center gap-1.5"><IcoTrash className="w-3.5 h-3.5" /> 重置宠物对战（宠物+战报+金币+默认出战）</button>
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
