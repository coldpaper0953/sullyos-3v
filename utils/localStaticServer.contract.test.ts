import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// scripts/local-static-server.cjs 是手机端（Termux）唯一的前端服务器，
// 也是 open-local-web.bat 在 PC 上用的那个。两处回归守卫：
//   1. MIME 表必须覆盖 dist/ 里真实出现的扩展名。漏一个就落到
//      application/octet-stream —— .wasm 少了正确类型会让
//      WebAssembly.instantiateStreaming 直接失败（MediaPipe 两个 11MB 文件），
//      .webmanifest 发成 octet-stream 浏览器可能拒收 manifest、PWA 装不上。
//   2. 路径边界必须按分隔符判，不能只 startsWith(root) —— 那会放过同级的
//      dist2/ 这类兄弟目录（`/%2e%2e/dist2/x` 解码后就能逃出去）。
//      默认只绑 127.0.0.1 影响有限，但这个文件没有任何鉴权，
//      一旦有人设 HOST=0.0.0.0 就是真漏洞。
const source = readFileSync(
    path.resolve(__dirname, '../scripts/local-static-server.cjs'),
    'utf8',
);

describe('local-static-server MIME 覆盖', () => {
    it.each([
        ['.wasm', 'application/wasm'],
        ['.webmanifest', 'application/manifest+json'],
        ['.woff2', 'font/woff2'],
        ['.gif', 'image/gif'],
        ['.mp3', 'audio/mpeg'],
        ['.txt', 'text/plain'],
    ])('%s 有显式 MIME（%s）', (ext, mime) => {
        const line = source
            .split(/\r?\n/)
            .find(l => l.trim().startsWith(`'${ext}':`));
        expect(line, `MIME 表里缺 ${ext}`).toBeTruthy();
        expect(line).toContain(mime);
    });

    it('原有的基础类型没被删掉', () => {
        for (const ext of ['.css', '.html', '.js', '.mjs', '.json', '.png', '.svg', '.webp', '.ico']) {
            expect(source, `MIME 表里缺 ${ext}`).toContain(`'${ext}':`);
        }
    });
});

describe('local-static-server 路径边界', () => {
    it('用分隔符判边界，而不是裸 startsWith(root)', () => {
        expect(source).toContain('path.sep');
        expect(source).toMatch(/fullPath !== root/);
        // 旧写法 `return fullPath.startsWith(root) ? fullPath : null;` 不能回来
        expect(source).not.toMatch(/return\s+fullPath\.startsWith\(root\)\s*\?/);
    });

    it('默认仍然只绑回环地址（127.0.0.1 才是安全上下文）', () => {
        expect(source).toContain("process.env.HOST || '127.0.0.1'");
    });
});
