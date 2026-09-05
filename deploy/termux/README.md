# 在手机上跑 SullyOS（Termux）

全套跑在手机本地：前端静态站 + 后端 API + PostgreSQL，都在 Termux 里。不需要 Docker，也不需要电脑常开。

浏览器开 `http://127.0.0.1:4173`。**这个地址是浏览器认可的安全上下文**，所以 Service Worker、Web Push、`crypto.subtle`、摄像头全都能用——这也是这份文档选 Termux 而不是 Android 内置「Linux 终端」的原因：后者是独立网络命名空间的虚拟机，手机浏览器只能通过虚拟网卡 IP 访问，那不算安全上下文，上面四样会全部失效。

---

## 一、准备

装 Termux（**从 F-Droid 或 GitHub Releases 装，别用 Google Play 那个**，Play 版本早就停更、包源对不上）。再装 Termux:API 才有 `termux-wake-lock`。

资源账先看一眼：

| | 大小 |
|---|---|
| 前端 `node_modules` | ~363 MB |
| 前端 `dist` | ~57 MB |
| 后端 `node_modules` | ~65 MB |
| pnpm store | ~250-350 MB |
| PostgreSQL + 数据 | ~60 MB 起 |

**合计准备 1 GB 以上空闲空间。** 构建阶段 Rollup 要把 75 个 chunk 的模块图全放进 Node 堆——2 GB 可用内存有 OOM 风险，4 GB 应该够；脚本里已经预置了 `--max-old-space-size=3072`。

---

## 二、一条命令装完

```bash
pkg install git
git clone <你的仓库地址> ~/sullyos
cd ~/sullyos
bash deploy/termux/setup.sh
```

**别 clone 到 `/sdcard` 或 `/storage`。** 共享存储没有 exec 权限也没有真实文件权限，pnpm 和 postgres 都会失败——脚本第一步就会拦住你。

`setup.sh` 做六件事，每步幂等（重复跑安全）：

1. `pkg install nodejs git postgresql openssl-tool`，并检查 Node ≥ 22
2. 装 pnpm
3. `initdb` + 起 postgres + `createdb sullyos`
4. **探 pgcrypto**——见下面「pgcrypto 那一关」
5. 后端 `pnpm install` → 生成 `backend/.env`（`APP_TOKEN` 和 `MODEL_VAULT_KEY` 自动随机填好）→ `pnpm build` → 跑迁移
6. 前端 `pnpm install` → `pnpm run build`

跑完还要你手填一处：`backend/.env` 里的 `MODEL_BASE_URL` / `MODEL_API_KEY` / `MODEL_NAME`（心跳用哪个模型）。把你在 SullyOS 前端里测通的那套抄过来即可。不填也能用，只是角色不会自主活动。

---

## 三、启动

```bash
termux-wake-lock                 # 必须。不加 Doze 会冻住心跳进程
bash deploy/termux/start.sh
```

起完会自己 `curl /health` 验一次。然后：

- 前端 `http://127.0.0.1:4173`
- 后端 `http://127.0.0.1:43210`
- 日志 `deploy/termux/run/{api,worker,web}.log`

在前端 **设置 →「SullyOS 自主后端」** 填 `http://127.0.0.1:43210`，用配对码接入（在已配对设备的面板里点「生成配对码」，15 分钟有效），然后点一次「完整同步角色、聊天与记忆宫殿」。

停：

```bash
bash deploy/termux/stop.sh       # 停 api/worker/web，postgres 保留
bash deploy/termux/stop.sh all   # 连 postgres 一起停
```

只重启某一个：`bash deploy/termux/start.sh api`（可选 `pg|api|worker|web`）。

---

## 四、开机自启（可选）

`start.sh` 用 `setsid nohup`，Termux 会话断了进程还在，但手机重启就没了。要真正常驻用 runit：

```bash
pkg install termux-services

for s in sullyos-api sullyos-worker sullyos-web; do
  mkdir -p $PREFIX/var/service/$s/log
  cp ~/sullyos/deploy/termux/services/$s/run $PREFIX/var/service/$s/run
  sed -i "s|__REPO__|$HOME/sullyos|" $PREFIX/var/service/$s/run
  chmod +x $PREFIX/var/service/$s/run
  ln -sf $PREFIX/share/termux-services/svlogger $PREFIX/var/service/$s/log/run
done

sv up sullyos-api sullyos-web
sv up sullyos-worker        # 想要角色自主活动才起
```

postgres 自己有现成的服务定义（`sv up postgresql`）。

状态和日志：`sv status sullyos-api`、`tail -f $PREFIX/var/log/sv/sullyos-api/current`。

配合 Termux:Boot 可以做到开机拉起，但**Doze 仍然是硬约束**——`termux-wake-lock` 每次都要有，否则息屏一会儿心跳就停。这不是代码问题，是 Android 电源管理。

---

## 五、pgcrypto 那一关

`backend/migrations/001_initial.sql` 第一行是 `CREATE EXTENSION IF NOT EXISTS pgcrypto;`。Termux 的 postgresql 包不一定带 contrib，`setup.sh` 第 4 步会先探一下并明确告诉你结果。

**如果缺**：整个 schema 只从 pgcrypto 用了 `gen_random_uuid()`，而它在 **PostgreSQL 13+ 是内核函数**（migrations 和 `src/` 里 `digest(` / `hmac(` / `crypt(` / `pgp_` 全部零命中，哈希都走 Node 的 `createHash`）。删掉那一行就能跑。

代价说清楚：`backend/src/migrate.ts` 会对「已应用后又被改过」的迁移抛 `Migration ... was changed after being applied.`。手机是全新库所以现在删没问题，但**改完之后 PC 上导出的 pg dump 就不能直接恢复到这台手机**了（dump 里 `schema_migrations` 存的是旧 checksum）。要迁数据就走前端的「完整同步」，别走 pg dump。

顺带一个事实：这套 schema 的真实版本底线是 **PostgreSQL 10**（唯一约束是 `001_initial.sql` 里的 identity 列），`compose.yaml` 钉的 `postgres:17-alpine` 是 PC 上的部署选择而不是需求。Termux 给什么版本基本都够。

---

## 六、备份

两部分，分开走，别漏：

**后端数据库**

```bash
bash deploy/termux/backup-db.sh          # 默认输出到 ~/sullyos-db-backups/
```

产出 `.dump` + `.sha256`。恢复 `pg_restore -d sullyos --clean --if-exists <文件>`。
（`backend/scripts/backup-database.sh` 用不了——它全程走 `docker compose exec`。）

**前端数据**（角色、聊天、记忆宫殿、相册、设置）存在浏览器 IndexedDB 里，拷文件搬不走。走设置页的「备份与恢复 (ZIP)」导出/导入，或用云端备份的 GitHub/WebDAV 通道中转。

---

## 七、更新

```bash
cd ~/sullyos
git pull
cd backend && pnpm install --frozen-lockfile && pnpm build && node --env-file=.env dist/migrate.js
cd .. && pnpm install --frozen-lockfile && NODE_OPTIONS=--max-old-space-size=3072 pnpm run build
bash deploy/termux/stop.sh && bash deploy/termux/start.sh
```

迁移是幂等的（checksum + advisory lock），重复跑安全。

---

## 八、已知限制

**断网 / 翻墙失败时 UI 会塌。** `index.html` 从 `cdn.tailwindcss.com` 加载整个样式层——仓库里没有 tailwind.config 也没有 PostCSS 步骤，那个 CDN 就是**唯一**的样式来源。而 Service Worker 里没有 fetch handler、没有用 Cache API，一点缓存兜底都没有。所以没网的时候是无样式的裸 HTML。这是已知取舍，不是 bug。同理受影响的还有 Google Fonts（退化成 sans-serif）、KaTeX 数学渲染（importmap 指向 esm.sh，且 `vite.config.ts` 把 katex 设成了 external）、`utils/assetUrl.ts` 那条五镜像的房间背景/BGM/贴纸链。

**Live2D 需要联网。** `utils/live2dCore.ts` 会先探 `public/vendor/live2dcubismcore.min.js`，但仓库里没这个目录，所以总是回落到 `cubism.live2d.com`。想离线就自己把官方 `live2dcubismcore.min.js` 放进 `public/vendor/`（涉及 Live2D 的许可条款，自行判断）。

**同源 TTS 代理不通。** `/api/minimax/*`、`/api/fishaudio/tts`、`/api/elevenlabs/tts` 只存在于 `vite.config.ts` 的 `server:` 块里，也就是只有 dev server 有。任何静态 `dist/` 部署下这些路径都会被 SPA fallback 返回 `index.html`——这在 PC 上跑 `pnpm preview` 也一样。要用 TTS 就在设置里填直连地址。

**别把 `HOST` 改成 `0.0.0.0`。** 后端只有一个静态 bearer token 挡着且没有 TLS；`local-static-server.cjs` 完全没有鉴权。而且局域网 IP 走明文 HTTP 不是安全上下文，Service Worker、推送、`crypto.subtle`、摄像头会全部失效。真要别的设备访问，用 SSH 端口转发让浏览器仍然看到 `127.0.0.1`。

**心跳是花钱的。** worker 每 `HEARTBEAT_POLL_MS` 检查一次到点的角色（默认已调到 120 秒）。轮询到点不等于每次都调 AI——角色自己的开关、活动时段、冷却、概率仍然生效。第一次只开最常聊的那一个角色观察。
