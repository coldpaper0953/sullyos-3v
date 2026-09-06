import React, { useEffect, useState } from 'react';
import { useOS } from '../context/OSContext';
import Chat from '../apps/Chat';

/**
 * 左上角未读红点 + 可拉起的小聊天窗。
 * - 有未读私聊消息时左上角显示红点（数字）；
 * - 点击拉起小聊天窗，功能与私聊一致（可回复）；
 * - 关闭窗口 = 已读不回（清掉未读，不当回事）。
 * 也可从任何地方派发 `petpvp-minichat-open`（detail: { charId? }）拉起指定角色的小窗。
 */
const MiniChatWindow: React.FC = () => {
    const { unreadMessages, clearUnread, setActiveCharacterId, characters } = useOS();
    const [open, setOpen] = useState(false);
    const [targetChar, setTargetChar] = useState('');

    const unreadEntries = Object.entries(unreadMessages || {}).filter(([, n]) => (n || 0) > 0);
    const totalUnread = unreadEntries.reduce((s, [, n]) => s + (n || 0), 0);
    const topUnreadChar = unreadEntries.sort((a, b) => (b[1] || 0) - (a[1] || 0))[0]?.[0] || '';

    const openChat = (charId: string) => {
        if (!charId) return;
        setTargetChar(charId);
        setActiveCharacterId(charId);
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

    // 关闭 = 已读不回：清掉未读红点，窗一关就当看过
    const closeAndMarkRead = () => {
        if (targetChar) clearUnread(targetChar);
        else if (topUnreadChar) clearUnread(topUnreadChar);
        setOpen(false);
    };

    const charName = characters.find(c => c.id === (targetChar || topUnreadChar))?.name || '私聊';

    return (
        <>
            {/* 左上角红点：有未读就亮，点击拉起小窗 */}
            {totalUnread > 0 && !open && (
                <button
                    onClick={() => openChat(targetChar || topUnreadChar)}
                    title={`${totalUnread} 条未读 · 点击打开小聊天窗`}
                    className="fixed left-2 top-1 z-[95] min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black shadow-md border border-white/60 flex items-center justify-center animate-pulse"
                >
                    {totalUnread > 99 ? '99+' : totalUnread}
                </button>
            )}
            {/* 小聊天窗：功能与私聊一致，可回复；关闭即已读不回 */}
            {open && (
                <div className="fixed z-[96] right-2 bottom-16 w-80 h-[26rem] max-h-[70vh] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white flex flex-col animate-fade-in">
                    <div className="shrink-0 px-3 py-2 bg-slate-50 border-b border-slate-200/70 flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-600 flex-1 truncate">💬 {charName}（小窗私聊）</span>
                        <button onClick={closeAndMarkRead} title="关闭并标记已读（已读不回）"
                            className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-400 text-[10px] font-bold active:scale-90">✕</button>
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
