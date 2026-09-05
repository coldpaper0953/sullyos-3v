import { describe, it, expect } from 'vitest';
import { readPairCode, stripPairParam, BACKEND_PAIR_PARAM } from './backendPairLink';

// 单设备配对链接：deploy/termux/pair.sh 打印 ?backendPair=<一次性码>，
// index.tsx 启动时收下并把参数从地址栏抹掉。这里守两件事：
//   1. 只认形状对的码，别把任意 query 值塞进设置面板的输入框
//   2. 清参数时只删自己那一个，path / hash / 其他 query 一律不能动
//      （地址栏里还有 openApp / activeMsgCharId 这些 SW 深链参数）
const BASE = 'http://127.0.0.1:4173/';

describe('readPairCode', () => {
    it('读出正常的配对码', () => {
        expect(readPairCode(`${BASE}?backendPair=A1B2-C3D4-E5F6`)).toBe('A1B2-C3D4-E5F6');
    });

    it('去掉首尾空白', () => {
        expect(readPairCode(`${BASE}?backendPair=${encodeURIComponent('  A1B2-C3D4-E5F6  ')}`)).toBe('A1B2-C3D4-E5F6');
    });

    it('没有参数时返回 null', () => {
        expect(readPairCode(BASE)).toBeNull();
        expect(readPairCode(`${BASE}?openApp=chat`)).toBeNull();
    });

    it('空值返回 null', () => {
        expect(readPairCode(`${BASE}?backendPair=`)).toBeNull();
        expect(readPairCode(`${BASE}?backendPair=${encodeURIComponent('   ')}`)).toBeNull();
    });

    it('形状不对的一律不认（挡住把任意 query 值填进输入框）', () => {
        expect(readPairCode(`${BASE}?backendPair=short`)).toBeNull();               // 太短
        expect(readPairCode(`${BASE}?backendPair=${'A'.repeat(33)}`)).toBeNull();   // 太长
        expect(readPairCode(`${BASE}?backendPair=${encodeURIComponent('A1B2 C3D4 E5F6')}`)).toBeNull(); // 含空格
        expect(readPairCode(`${BASE}?backendPair=${encodeURIComponent('<script>x</script>')}`)).toBeNull();
    });

    it('非法 URL 返回 null 而不是抛异常', () => {
        expect(readPairCode('not a url')).toBeNull();
        expect(readPairCode('')).toBeNull();
    });

    it('参数名与导出的常量一致', () => {
        expect(BACKEND_PAIR_PARAM).toBe('backendPair');
        expect(readPairCode(`${BASE}?${BACKEND_PAIR_PARAM}=A1B2-C3D4-E5F6`)).toBe('A1B2-C3D4-E5F6');
    });
});

describe('stripPairParam', () => {
    it('删掉配对码参数', () => {
        expect(stripPairParam(`${BASE}?backendPair=A1B2-C3D4-E5F6`)).toBe(BASE);
    });

    it('只删自己那个，其他 query 原样保留', () => {
        const cleaned = stripPairParam(`${BASE}?openApp=chat&backendPair=A1B2-C3D4-E5F6&activeMsgCharId=c1`);
        expect(cleaned).not.toBeNull();
        const url = new URL(cleaned!);
        expect(url.searchParams.get('backendPair')).toBeNull();
        expect(url.searchParams.get('openApp')).toBe('chat');
        expect(url.searchParams.get('activeMsgCharId')).toBe('c1');
    });

    it('path 和 hash 不受影响', () => {
        const cleaned = stripPairParam('http://127.0.0.1:4173/sub/page?backendPair=A1B2-C3D4-E5F6#frag');
        expect(cleaned).toBe('http://127.0.0.1:4173/sub/page#frag');
    });

    it('形状不对的码也要清掉（不然刷新会反复撞失效）', () => {
        // readPairCode 会拒绝它，但参数仍然必须离开地址栏
        expect(stripPairParam(`${BASE}?backendPair=short`)).toBe(BASE);
    });

    it('没有该参数时返回 null（调用方据此跳过 replaceState）', () => {
        expect(stripPairParam(BASE)).toBeNull();
        expect(stripPairParam(`${BASE}?openApp=chat`)).toBeNull();
    });

    it('非法 URL 返回 null 而不是抛异常', () => {
        expect(stripPairParam('not a url')).toBeNull();
    });
});
