const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'dist');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  // 下面这些 dist/ 里真实存在，漏了会落到 octet-stream：
  // .wasm 少了正确类型 instantiateStreaming 直接失败（MediaPipe 两个 11MB 文件）；
  // .webmanifest 发成 octet-stream 浏览器可能拒收 manifest，PWA 装不上。
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  // MediaPipe 模型（.task）与 Live2D 模型（.moc3/.model3.json 走 .json）按二进制取，
  // 显式声明只为避免将来有人误以为 octet-stream 是 bug。
  '.task': 'application/octet-stream',
  '.moc3': 'application/octet-stream',
};

function resolvePath(urlPath) {
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.resolve(root, relativePath);
  // 必须按路径分隔符判边界，不能只看字符串前缀：`startsWith(root)` 会放过
  // 同级的 dist2/ 这类兄弟目录（`/%2e%2e/dist2/x` 解码后就能逃出去）。
  // 默认只绑 127.0.0.1 时影响有限，但这个文件没有任何鉴权，一旦设 HOST=0.0.0.0 就是真漏洞。
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) return null;
  return fullPath;
}

function sendFile(filePath, res) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const requestedPath = resolvePath(urlPath);

  if (!requestedPath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(requestedPath, (statError, stats) => {
    if (!statError && stats.isFile()) {
      sendFile(requestedPath, res);
      return;
    }

    sendFile(path.join(root, 'index.html'), res);
  });
});

server.listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}`);
  console.log(`Serving ${root}`);
});
