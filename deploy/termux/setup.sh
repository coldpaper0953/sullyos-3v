#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · Termux 一次性初始化
#
# 非 root Android 没有 /usr/bin/env，所以 shebang 直接写 Termux 的 bash 绝对路径。
# 用法：bash deploy/termux/setup.sh
#
# 幂等：已装的包会跳过，已初始化的库不会重建，已存在的 .env 不会被覆盖。

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
pgdata="$PREFIX/var/lib/postgresql"
pglog="$PREFIX/var/log/postgresql.log"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

case "$repo_root" in
  /storage/*|/sdcard/*)
    die "仓库在 $repo_root —— 共享存储没有 exec 权限也没有真实文件权限，pnpm 和 postgres 都会失败。挪到 ~ 下面再跑。"
    ;;
esac

say "1/6 预检 + 装缺的系统包"
# 先把环境状况整个列一遍（doctor.sh 只读，缺项它会告诉你怎么补）。
# 这里不因为 doctor 报错就退出——下面几步正是来补这些缺项的。
bash "$repo_root/deploy/termux/doctor.sh" || true

need_pkgs=()
command -v node    >/dev/null 2>&1 || need_pkgs+=(nodejs)
command -v git     >/dev/null 2>&1 || need_pkgs+=(git)
command -v psql    >/dev/null 2>&1 || need_pkgs+=(postgresql)
command -v openssl >/dev/null 2>&1 || need_pkgs+=(openssl-tool)
command -v curl    >/dev/null 2>&1 || need_pkgs+=(curl)

if [ ${#need_pkgs[@]} -eq 0 ]; then
  echo "系统包齐了，跳过 pkg install"
else
  echo "要装：${need_pkgs[*]}"
  pkg update -y
  pkg install -y "${need_pkgs[@]}"
fi

command -v node >/dev/null || die "node 没装上"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || die "Node $node_major 太旧，backend 要求 >=22"
printf 'node %s / npm %s\n' "$(node -v)" "$(npm -v 2>/dev/null || echo '-')"

say "2/6 装 pnpm"
if ! command -v pnpm >/dev/null; then
  npm i -g pnpm
fi

# pnpm 10 的 manage-package-manager-versions 默认开着：它会照着
# backend/package.json 的 "packageManager": "pnpm@10.34.5" 去下自己那个版本的
# 原生二进制。安卓上要的是 @pnpm/exe.android-arm64，而 pnpm-lock.yaml 是在
# Windows 上生成的、没有这一项，pnpm 拒绝安装拿不到校验值的原生二进制：
#   Cannot verify the identity of the @pnpm/exe.android-arm64 native binary
# 手机上直接用已经装好的 pnpm 就行。写进 ~/.npmrc 而不是用 `pnpm config set`，
# 因为后者本身也会先跑一遍版本自管逻辑，同样会炸在这里。
npmrc="$HOME/.npmrc"
if ! grep -q '^manage-package-manager-versions=' "$npmrc" 2>/dev/null; then
  printf 'manage-package-manager-versions=false\n' >> "$npmrc"
  echo "已在 $npmrc 关掉 pnpm 版本自管"
fi

pnpm --version

say "3/6 初始化 PostgreSQL"
if [ -d "$pgdata/base" ]; then
  echo "已初始化，跳过 initdb"
else
  mkdir -p "$(dirname "$pgdata")"
  initdb "$pgdata"
fi

if pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
  echo "postgres 已在跑"
else
  mkdir -p "$(dirname "$pglog")"
  pg_ctl -D "$pgdata" -l "$pglog" start
  # initdb 之后第一次起需要一两秒才能接受连接
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pg_isready -q && break
    sleep 1
  done
fi
pg_isready || die "postgres 起不来，看 $pglog"

if psql -lqt | cut -d'|' -f1 | grep -qw sullyos; then
  echo "库 sullyos 已存在"
else
  createdb sullyos
fi

say "4/6 探 pgcrypto"
# 001_initial.sql 第一行是 CREATE EXTENSION pgcrypto。Termux 的 postgresql 包
# 不一定带 contrib；带不带这里先说清楚，别等迁移跑一半才炸。
if psql -d sullyos -tAc "select 1 from pg_available_extensions where name='pgcrypto'" | grep -q 1; then
  echo "pgcrypto 可用 ✓"
else
  pg_major="$(psql -d sullyos -tAc 'show server_version_num' | cut -c1-2)"
  cat <<EOF

  !! 这套 PostgreSQL 没有 pgcrypto。

  整个 schema 只从 pgcrypto 用了 gen_random_uuid()，而它在 PostgreSQL 13+
  是内核函数（当前是 PG ${pg_major}.x）。所以把这一行删掉就能跑：

      backend/migrations/001_initial.sql  第 1 行
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

  代价：migrate.ts 会对「已应用后又被改过」的迁移报错。手机是全新库所以现在
  删没问题，但之后 PC 导出的 pg dump 就不能直接恢复到这台手机了（dump 里
  schema_migrations 存的是旧 checksum）。迁数据请走前端的「完整同步」。

  删完重跑本脚本。

EOF
  die "pgcrypto 缺失，见上面的说明"
fi

say "5/6 装依赖 + 建 .env + 跑迁移"
cd "$repo_root/backend"
pnpm install --frozen-lockfile

if [ -f .env ]; then
  echo ".env 已存在，保留不动"
else
  cp "$repo_root/deploy/termux/env.example" .env
  # 顺手把两个密钥生成好，省得手填
  token="$(openssl rand -hex 32)"
  vault="$(openssl rand -hex 32)"
  sed -i "s|^APP_TOKEN=$|APP_TOKEN=$token|" .env
  sed -i "s|^MODEL_VAULT_KEY=$|MODEL_VAULT_KEY=$vault|" .env
  echo "已生成 backend/.env，APP_TOKEN 与 MODEL_VAULT_KEY 已随机填好"
  echo "还需你手填：MODEL_BASE_URL / MODEL_API_KEY / MODEL_NAME"
fi

mkdir -p "$(grep '^BACKUP_DIR=' .env | cut -d= -f2-)"

pnpm build
# 用编译产物而不是 pnpm db:migrate，这样连 tsx/esbuild 都不需要
node --env-file=.env dist/migrate.js

say "6/6 前端依赖 + 构建"
cd "$repo_root"
pnpm install --frozen-lockfile
# Rollup 要把 75 个 chunk 的模块图全放进 Node 堆，2GB 可用内存会被 OOM 杀
NODE_OPTIONS=--max-old-space-size=3072 pnpm run build

cat <<'EOF'

初始化完成。

下一步：
  1. 填 backend/.env 里的 MODEL_BASE_URL / MODEL_API_KEY / MODEL_NAME
  2. termux-wake-lock            # 不加 Doze 会挂掉心跳进程
  3. bash deploy/termux/start.sh
  4. bash deploy/termux/pair.sh  # 打印配对链接，点开即自动填好配对码

EOF

# 后端起着就顺手把配对链接打出来——这样从零到能用就是一条命令。
# 起不着（还没 start）也不算失败，用户按上面第 3、4 步走即可。
if curl -fsS --max-time 3 "http://127.0.0.1:$(grep -m1 '^PORT=' "$repo_root/backend/.env" | cut -d= -f2- | tr -d '[:space:]')/health" >/dev/null 2>&1; then
  say "顺手生成配对链接"
  bash "$repo_root/deploy/termux/pair.sh" || true
fi
