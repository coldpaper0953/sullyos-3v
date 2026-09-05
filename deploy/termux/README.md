# 在手机上跑 SullyOS（Termux）

全套跑在手机本地：前端静态站 + 后端 API + PostgreSQL，都在 Termux 里。不需要 Docker，也不需要电脑常开。

浏览器开 `http://127.0.0.1:4173`。**这个地址是浏览器认可的安全上下文**，所以 Service Worker、Web Push、`crypto.subtle`、摄像头全都能用——这也是这份文档选 Termux 而不是 Android 内置「Linux 终端」的原因：后者是独立网络命名空间的虚拟机，手机浏览器只能通过虚拟网卡 IP 访问，那不算安全上下文，上面四样会全部失效。

---

## 一、准备

装 Termux（**从 F-Droid 或 GitHub Releases 装，别用 Google Play 那个**，Play 版本早就停更、包源对不上）。再装 Termux:API 才有 `termux-wake-lock`。

需要的环境（`setup.sh` 会自动装缺的，这里列出来是为了让你知道它在装什么）：

| | 用途 |
|---|---|
| Node ≥ 22 | `backend/package.json` 的 `engines` 要求 |
| pnpm | 包管理 |
| git | clone；后端的备份通道也会调它 |
| PostgreSQL ≥ 10 | Termux 包一般给 15/16/17，都够。schema 真实底线是 PG 10 |
| openssl-tool | 生成 `APP_TOKEN` / `MODEL_VAULT_KEY` |
| curl | 健康检查与生成配对码 |
| termux-api（可选） | 有它才有 `termux-wake-lock`。不装 Doze 会冻住心跳进程 |

**要你手填的配置只有 3 个**：`MODEL_BASE_URL` / `MODEL_API_KEY` / `MODEL_NAME`（心跳用哪个模型）。其余全自动——`APP_TOKEN` 和 `MODEL_VAULT_KEY` 随机生成，`DATABASE_URL` / `PORT` / `HOST` / `BACKUP_DIR` / `ALLOWED_ORIGINS` 模板里都填好了。

想在动手前先看看环境缺什么，随时可以单独跑：

```bash
bash deploy/termux/doctor.sh
```

只读检测，什么都不装不改。列出命令与版本、postgres 状态、`sullyos` 库、pgcrypto、端口、`.env` 各字段、构建产物、磁盘内存，缺什么就给出对应的修复命令；全就绪退出码 0，有缺项退 1。

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

## 二、一键部署

全新设备，从零到能用，**复制这一整行**：

```bash
pkg install -y git && git clone https://github.com/coldpaper0953/sullyos-3v.git ~/sullyos && bash ~/sullyos/deploy/termux/deploy.sh
```

已经 clone 过、想拉新代码重跑：

```bash
cd ~/sullyos && git pull && bash deploy/termux/deploy.sh
```

**别 clone 到 `/sdcard` 或 `/storage`。** 共享存储没有 exec 权限也没有真实文件权限，pnpm 和 postgres 都会失败——脚本第一步就会拦住你。

**Termux 装完先 `apt update && apt full-upgrade`。** 全新 bootstrap 的包版本经常跟当前仓库对不上，典型症状是 `libcurl.so` 缺符号，`curl` 和 `git clone` 一起挂。注意用 `apt` 而不是 `pkg`——`pkg` 自己要调 curl，会死在同一个地方。

`deploy.sh` 就是把下面三个脚本串起来跑，全都幂等，中途失败修完再跑一遍即可，不用从头来：

| | 干什么 |
|---|---|
| `setup.sh` | 装环境、建库、装依赖、构建（六步，见下） |
| `start.sh` | 起 postgres / api / worker / 前端静态站 |
| `pair.sh` | 打印配对链接 |

`setup.sh` 那六步：

1. 跑一遍 `doctor.sh` 把现状列出来，然后**只装缺的包**，并检查 Node ≥ 22
2. 装 pnpm——按 `backend/package.json` 的 `packageManager` 装**精确版本**，见「已知限制」里那条
3. `initdb` + 起 postgres + `createdb sullyos`
4. **探 pgcrypto**——见下面「pgcrypto 那一关」
5. 后端 `pnpm install` → 生成 `backend/.env`（`APP_TOKEN` / `MODEL_VAULT_KEY` 随机填好，`DATABASE_URL` 的 socket 目录和用户名现探现填）→ `pnpm build` → 跑迁移
6. 前端 `pnpm install` → `pnpm run build`

跑完还要你手填一处：`backend/.env` 里的 `MODEL_BASE_URL` / `MODEL_API_KEY` / `MODEL_NAME`（心跳用哪个模型）。把你在 SullyOS 前端里测通的那套抄过来即可。不填也能用，只是角色不会自主活动。

想在动手前先看看环境缺什么，`doctor.sh` 是只读的，随时可以单跑：

```bash
bash ~/sullyos/deploy/termux/doctor.sh
```

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

在前端 **设置 →「SullyOS 自主后端」** 填 `http://127.0.0.1:43210`。接入方式见下一节（单设备不需要「另一台已配对设备」）。

停：

```bash
bash deploy/termux/stop.sh       # 停 api/worker/web，postgres 保留
bash deploy/termux/stop.sh all   # 连 postgres 一起停
```

只重启某一个：`bash deploy/termux/start.sh api`（可选 `pg|api|worker|web`）。

`start.sh` 用 `setsid nohup` 起进程：Termux 切后台、关掉终端会话都不影响，但**手机重启后进程就没了**，重跑一遍 `bash deploy/termux/start.sh` 即可。

不管进程怎么起，**Doze 都是硬约束**——`termux-wake-lock` 每次都要有，否则息屏一会儿心跳就停。这不是代码问题，是 Android 电源管理。

---

## 四、配对（单设备）

后端的配对流程原本假设你有两台设备：生成配对码的 `POST /v1/pairing-codes` 要带 `APP_TOKEN`（`backend/src/api.ts:36-37` 的免鉴权白名单里没有它），而设置面板里「生成配对码」那块又被「已有 token」门控。手机自己既是服务端又是唯一客户端时就死锁了。

破法是让持有 token 的一方——手机上的 shell——去生成码：

```bash
bash deploy/termux/pair.sh
```

它从 `backend/.env` 读 `APP_TOKEN`，调后端生成一个 15 分钟一次性码，然后打印：

```
  http://127.0.0.1:4173/?backendPair=A1B2-C3D4-E5F6
```

在手机浏览器点开这条链接：配对码会**自动填进** 设置 →「SullyOS 自主后端」的输入框，面板也会自动展开，你只要点一下「配对」。参数会立刻从地址栏抹掉（码是一次性的，留着刷新只会反复撞失效）。

想手输的话脚本也会把裸码打出来。

配对完点一次「**完整同步角色、聊天与记忆宫殿**」——以这台设备为权威快照把数据推上后端。

> `setup.sh` 结尾如果后端已经在跑，会自己调一次 `pair.sh` 把链接打出来。
>
> 存后端地址和 token 的 `sullyos_backend_chat_v1` **不在备份导出里**，也不在 `utils/lsMirror.ts` 的镜像名单里——清一次浏览器数据 token 就丢了。重跑 `pair.sh` 拿条新链接即可，随时可用。

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

**pnpm 的版本自管在安卓上必须关掉。** `backend/package.json` 里有 `"packageManager": "pnpm@10.34.5"`，pnpm 10 默认会照这个字段去下自己那个版本的原生二进制。安卓要的是 `@pnpm/exe.android-arm64`，而 `pnpm-lock.yaml` 是在 Windows 上生成的、没有这一项，于是 pnpm 拒绝安装拿不到校验值的原生二进制：

```
[ERROR] Cannot verify the identity of the @pnpm/exe.android-arm64 native binary:
        it is missing from pnpm-lock.yaml.
```

`setup.sh` 第 2 步已经会往 `~/.npmrc` 写 `manage-package-manager-versions=false` 把它关掉。**如果你绕过 setup.sh 手动跑 `pnpm install`**，先自己补上这一行：

```bash
echo 'manage-package-manager-versions=false' >> ~/.npmrc
```

（写文件而不是用 `pnpm config set`，因为后者本身也要先跑一遍版本自管逻辑，一样会炸在这里。）

**重 clone / 重装仓库之前，先停干净旧进程。** `start.sh` 用 `setsid nohup` 起的守护进程不跟着仓库目录走——`rm -rf ~/sully` 删得掉文件，删不掉进程。旧 api 会揣着旧 APP_TOKEN 继续跑（新 `pair.sh` 请求被拒 401），旧 web 继续占着 4173（新 web 起不来 EADDRINUSE）。重装前跑：

```bash
bash ~/sully/deploy/termux/stop.sh all
```

万一仓库已经删了没法跑 stop，就在 Android 设置里「强行停止」Termux（setsid 进程也属于这个 UID，会一起被杀）。新版 `stop.sh` 和 `start.sh` 还会扫 `/proc` 按命令行特征清这类孤儿，双保险。
