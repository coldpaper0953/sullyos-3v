import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import Chat from '../apps/Chat';
import TokenImg from './os/TokenImg';

// 小聊天窗可拖动位置的 localStorage 键（弹窗拖标题栏；红点固定左上角）
const POS_KEY = 'petpvp-minichat-pos';
const loadPos = (): { x: number; y: number } => {
    try {
        const raw = localStorage.getItem(POS_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
        }
    } catch { /* ignore */ }
    // 默认停在原来的位置（右下角，right-2 bottom-16）
    return { x: Math.max(8, window.innerWidth - 328), y: Math.max(8, window.innerHeight - 480) };
};

/**
 * 左上角未读红点 + 通讯录弹窗 + 可拉起的小聊天窗。
 * - 有未读私聊消息时左上角显示红点（数字），红点固定左上角；
 * - 通讯录弹窗和小聊天窗都支持拖动（按住标题栏拖），小窗位置记忆在 localStorage；
 * - 点红点弹「通讯录列表」：列出谁发来了未读消息（头像/名字/未读数），谁在群里和 user
 *   同一个群聊就显示「群里聊」按钮直接跳到那个群；每条都有「忽略」按钮（清未读不看）；
 * - 点某人 → 打开与私聊功能一致的小聊天窗（可回复）；
 * - 关闭窗口 = 已读不回（清掉未读，不当回事）。
 * 也可从任何地方派发 `petpvp-minichat-open`（detail: { charId? }）直接拉起指定角色的小窗。
 */
const MiniChatWindow: React.FC = () => {
    const { unreadMessages, clearUnread, setActiveCharacterId, characters, groups, openApp } = useOS();
    const [open, setOpen] = useState(false);
    const [targetChar, setTargetChar] = useState('');
    // view：redDot=只亮红点 / contacts=通讯录列表弹窗 / chat=某人小窗
    const [view, setView] = useState<'redDot' | 'contacts' | 'chat'>('redDot');
    // 弹窗（小聊天窗）可拖动：拖标题栏，位置记忆在 localStorage
    const [pos, setPos] = useState(loadPos);
    const [dragging, setDragging] = useState(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    const unreadEntries = Object.entries(unreadMessages || {}).filter(([, n]) => (n || 0) > 0);
    const totalUnread = unreadEntries.reduce((s, [, n]) => s + (n || 0), 0);
    const topUnreadChar = unreadEntries.sort((a, b) => (b[1] || 0) - (a[1] || 0))[0]?.[0] || '';

    const openChat = (charId: string) => {
        if (!charId) return;
        setTargetChar(charId);
        setActiveCharacterId(charId);
        setView('chat');
        setOpen(true);
    };

    useEffect(() => {
        const h = (e: Event) => {
            const { charId } = ((e as CustomEvent).detail || {}) as { charId?: string };
            openChat(charId || topUnreadChar);
        };
        window.addEventListener('petpvp-minichat-open', h);
        return () => window.removeEventListener('petpvp-minichat-open', h);
    }, [topUnreadChar]);

    // 拖动弹窗标题栏：pointerdown 记录起点，pointermove 更新（限屏内），pointerup 收尾
    useEffect(() => {
        if (!dragging) return;
        const move = (ev: PointerEvent) => {
            setPos({
                x: Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dragOffsetRef.current.x)),
                y: Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dragOffsetRef.current.y)),
            });
        };
        const up = () => setDragging(false);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
    }, [dragging]);

    useEffect(() => {
        if (!dragging) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ } }
    }, [pos, dragging]);

    // 关闭 = 已读不回：清掉未读红点，窗一关就当看过
    const closeAndMarkRead = () => {
        if (targetChar) clearUnread(targetChar);
        else if (topUnreadChar) clearUnread(topUnreadChar);
        setOpen(false);
        setView('redDot');
    };

    const charOf = (id: string) => characters.find(c => c.id === id);
    // 谁和 user 同在一个群（群成员不含 'user'，user 隐式在场，所以只看角色在不在群里）
    const sharedGroupOf = (charId: string) => groups.find(g => g.members.includes(charId));

    const jumpToGroup = (groupId: string) => {
        window.dispatchEvent(new CustomEvent('groupchat-jump', { detail: { groupId } }));
        openApp(AppID.GroupChat);
        setOpen(false);
        setView('redDot');
    };

    return (
        <>
            {/* 红点：有未读就亮（固定左上角）；点击弹通讯录列表 */}
            {totalUnread > 0 && !open && (
                <button
                    onClick={() => { setOpen(true); setView('contacts'); }}
                    title={`${totalUnread} 条未读 · 点击打开通讯录`}
                    className="fixed left-2 top-1 z-[95] min-w-[18px] h-[18px] px-1 rounded-full bg-slate-800 text-white text-[9px] font-black shadow-md border border-white/60 flex items-center justify-center animate-pulse"
                >
                    {totalUnread > 99 ? '99+' : totalUnread}
                </button>
            )}

            {/* 通讯录列表弹窗：标题栏可拖动（跟随小窗位置），点背景关闭 */}
            {open && view === 'contacts' && (
                <div className="fixed inset-0 z-[215] bg-black/50 flex items-center justify-center p-6" onClick={() => { setOpen(false); setView('redDot'); }}>
                    <div className="bg-white rounded-2xl w-full max-w-sm p-4 relative animate-fade-in max-h-[75%] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div
                            onPointerDown={e => { dragOffsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; setDragging(true); }}
                            className="flex items-center justify-between mb-3 cursor-grab active:cursor-grabbing touch-none"
                            title="按住这里拖动弹窗"
                        >
                            <span className="text-sm font-bold text-slate-800">未读消息（{totalUnread}）</span>
                            <button onClick={() => { setOpen(false); setView('redDot'); }} className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="w-3.5 h-3.5"><path d="M6 6l12 12M18 6L6 18" /></svg>
                            </button>
                        </div>
                        <div className="space-y-2">
                            {unreadEntries.length === 0 && <div className="text-center py-8 text-xs text-slate-400">没有未读消息</div>}
                            {unreadEntries.map(([charId, count]) => {
                                const c = charOf(charId);
                                const grp = sharedGroupOf(charId);
                                return (
                                    <div key={charId} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                                        <TokenImg value={c?.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-slate-700 truncate">{c?.name || '未知联系人'}</div>
                                            <div className="text-[10px] text-slate-500 font-bold">{count} 条新消息</div>
                                        </div>
                                        {grp && (
                                            <button onClick={() => jumpToGroup(grp.id)} title={`跳转到群聊「${grp.name}」`}
                                                className="shrink-0 px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 text-[10px] font-bold active:scale-95">
                                                群里聊
                                            </button>
                                        )}
                                        <button onClick={() => openChat(charId)} title="小窗私聊"
                                            className="shrink-0 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-800 text-white text-[10px] font-bold active:scale-95">
                                            私聊
                                        </button>
                                        <button onClick={() => clearUnread(charId)} title="忽略：清掉未读，不看内容"
                                            className="shrink-0 px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-400 text-[10px] font-bold active:scale-95">
                                            忽略
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-[9px] text-slate-400 mt-3">和你在同一个群里的联系人会显示「群里聊」，点击直接跳到那个群。</p>
                    </div>
                </div>
            )}

            {/* 小聊天窗：功能与私聊一致，可回复；标题栏拖动（位置记忆）；关闭即已读不回 */}
            {open && view === 'chat' && (
                <div style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
                    className="fixed z-[96] w-80 h-[26rem] max-h-[70vh] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white flex flex-col animate-fade-in">
                    <div
                        onPointerDown={e => { dragOffsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; setDragging(true); }}
                        title="按住这里拖动窗口"
                        className={`shrink-0 px-2.5 py-1 bg-slate-50 border-b border-slate-200/70 flex items-center gap-2 touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    >
                        <button onClick={() => setView('contacts')} title="返回通讯录列表"
                            className="w-5 h-5 rounded-full bg-white border border-slate-200 text-slate-400 flex items-center justify-center active:scale-90">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5"><path d="M14.5 5.5L8 12l6.5 6.5" /></svg>
                        </button>
                        <span className="text-[11px] font-bold text-slate-600 flex-1 truncate">{charOf(targetChar)?.name || '私聊'}</span>
                        <button onClick={closeAndMarkRead} title="关闭并标记已读（已读不回）"
                            className="w-5 h-5 rounded-full bg-white border border-slate-200 text-slate-400 flex items-center justify-center active:scale-90">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="w-3 h-3"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <Chat />
                    </div>
                </div>
            )}
        </>
    );
};

export default MiniChatWindow;
