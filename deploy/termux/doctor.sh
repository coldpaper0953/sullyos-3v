#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · Termux 环境预检（只读，什么都不装、不改）
#
# 用法：bash deploy/termux/doctor.sh
# 退出码：0 = 全部就绪；1 = 有缺项（末尾会列出每项的修复命令）
#
# setup.sh 开头会调它，你也可以随时单独跑一遍看状态。

set -uo pipefail   # 刻意不加 -e：这个脚本的职责就是把失败逐条报出来

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
env_file="$repo_root/backend/.env"
pgdata="${PREFIX:-/data/data/com.termux/files/usr}/var/lib/postgresql"

MISSING=()
NOTE=()

ok()   { printf '  \033[32m✓\033[0m %-26s %s\n' "$1" "${2:-}"; }
bad()  { printf '  \033[31m✗\033[0m %-26s %s\n' "$1" "${2:-}"; MISSING+=("$3"); }
warn() { printf '  \033[33m!\033[0m %-26s %s\n' "$1" "${2:-}"; NOTE+=("$3"); }
head_() { printf '\n\033[1;36m%s\033[0m\n' "$1"; }

# ── 位置 ──────────────────────────────────────────────
head_ "位置"
case "$repo_root" in
  /storage/*|/sdcard/*)
    bad "仓库位置" "$repo_root" "把仓库挪到 ~ 下：共享存储没有 exec 权限也没有真实文件权限，pnpm 和 postgres 都会失败"
    ;;
  *)
    ok "仓库位置" "$repo_root"
    ;;
esac

# ── 命令 ──────────────────────────────────────────────
head_ "命令"
if command -v node >/dev/null 2>&1; then
  node_v="$(node -v)"
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$node_major" -ge 22 ] 2>/dev/null; then
    ok "node" "$node_v"
  else
    bad "node" "$node_v（需要 >= 22）" "pkg install nodejs   # backend/package.json 要求 node >=22"
  fi
else
  bad "node" "未安装" "pkg install nodejs"
fi

if command -v pnpm >/dev/null 2>&1; then ok "pnpm" "$(pnpm --version 2>/dev/null)"; else bad "pnpm" "未安装" "npm i -g pnpm"; fi
if command -v git  >/dev/null 2>&1; then ok "git"  "$(git --version 2>/dev/null | awk '{print $3}')"; else bad "git" "未安装" "pkg install git"; fi
if command -v curl >/dev/null 2>&1; then ok "curl" ""; else bad "curl" "未安装" "pkg install curl"; fi
if command -v openssl >/dev/null 2>&1; then ok "openssl" ""; else bad "openssl" "未安装" "pkg install openssl-tool   # 生成 APP_TOKEN / MODEL_VAULT_KEY"; fi
if command -v psql >/dev/null 2>&1; then
  ok "postgresql" "$(psql --version 2>/dev/null | awk '{print $3}')"
else
  bad "postgresql" "未安装" "pkg install postgresql"
fi
if command -v termux-wake-lock >/dev/null 2>&1; then
  ok "termux-api" "termux-wake-lock 可用"
else
  warn "termux-api" "未安装" "pkg install termux-api  +  装 Termux:API 这个 App。不装的话 Doze 会冻住心跳进程"
fi

# ── 数据库 ────────────────────────────────────────────
head_ "数据库"
if command -v pg_ctl >/dev/null 2>&1 && [ -d "$pgdata/base" ]; then
  ok "数据目录" "$pgdata"
else
  bad "数据目录" "未初始化" "initdb \"$pgdata\""
fi

if command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  ok "postgres 进程" "在跑"
  if psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw sullyos; then
    ok "库 sullyos" "已存在"
    if psql -d sullyos -tAc "select 1 from pg_available_extensions where name='pgcrypto'" 2>/dev/null | grep -q 1; then
      ok "pgcrypto" "可用"
    else
      pgv="$(psql -d sullyos -tAc 'show server_version_num' 2>/dev/null | cut -c1-2)"
      bad "pgcrypto" "不可用（PG ${pgv:-?}.x）" "删掉 backend/migrations/001_initial.sql 第 1 行的 CREATE EXTENSION pgcrypto —— 全 schema 只用了 gen_random_uuid()，它在 PG 13+ 是内核函数。注意改完 PC 的 pg dump 就不能直接恢复到手机了（checksum 变了），迁数据走前端「完整同步」"
    fi
  else
    bad "库 sullyos" "不存在" "createdb sullyos"
  fi
else
  warn "postgres 进程" "没在跑" "bash deploy/termux/start.sh pg"
fi

# ── 配置 ──────────────────────────────────────────────
head_ "配置"
if [ -f "$env_file" ]; then
  ok "backend/.env" "存在"
  read_env() { grep -m1 "^$1=" "$env_file" 2>/dev/null | cut -d= -f2- | sed 's/\r$//'; }
  for key in APP_TOKEN MODEL_VAULT_KEY; do
    if [ -n "$(read_env "$key")" ]; then ok "  $key" "已填"; else bad "  $key" "空" "在 backend/.env 里填：$key=\$(openssl rand -hex 32)"; fi
  done
  missing_model=()
  for key in MODEL_BASE_URL MODEL_API_KEY MODEL_NAME; do
    [ -n "$(read_env "$key")" ] || missing_model+=("$key")
  done
  if [ ${#missing_model[@]} -eq 0 ]; then
    ok "  模型三件套" "已填"
  else
    warn "  模型三件套" "缺 ${missing_model[*]}" "在 backend/.env 里填心跳用的模型（OpenAI 兼容，不带 /chat/completions 后缀）。不填也能用，只是角色不会自主活动"
  fi

  # DATABASE_URL 走 Unix socket 的话，验一下那个目录里真有 socket 文件。
  # Termux 的 postgresql 用 $PREFIX/tmp，不是 Debian 的 /var/run/postgresql；
  # 写错了要等 migrate 才炸，报 connect ENOENT .../.s.PGSQL.5432。
  db_url="$(read_env DATABASE_URL)"
  case "$db_url" in
    *host=/*)
      sock_dir="${db_url##*host=}"; sock_dir="${sock_dir%%&*}"
      if [ -S "$sock_dir/.s.PGSQL.5432" ]; then
        ok "  DATABASE_URL socket" "$sock_dir"
      else
        real_dir="$(psql -d sullyos -tAc 'show unix_socket_directories' 2>/dev/null | cut -d, -f1 | tr -d '[:space:]')"
        bad "  DATABASE_URL socket" "$sock_dir 里没有 .s.PGSQL.5432" "postgres 实际用的是 ${real_dir:-$PREFIX/tmp}；重跑 bash deploy/termux/setup.sh 会自动校正这一行"
      fi
      # 走 socket 时 URL 里必须带 user=：pg 的默认用户名只从 process.env.USER 取
      # （pg/lib/defaults.js:5），Termux 不设这个变量，缺了就是 28000。
      case "$db_url" in
        *user=*) ok "  DATABASE_URL user" "已带" ;;
        *)
          real_user="$(psql -d sullyos -tAc 'select current_user' 2>/dev/null | tr -d '[:space:]')"
          bad "  DATABASE_URL user" "缺 user= 参数" "没有它 migrate 会报 no PostgreSQL user name specified in startup packet；应该是 ${real_user:-$(id -un)}。重跑 bash deploy/termux/setup.sh 会自动补上"
          ;;
      esac
      ;;
    "") bad "  DATABASE_URL" "空" "重跑 bash deploy/termux/setup.sh" ;;
    *) ok "  DATABASE_URL" "走 TCP，跳过 socket 检查" ;;
  esac

  port="$(read_env PORT)"; port="${port:-43210}"
else
  bad "backend/.env" "不存在" "cp deploy/termux/env.example backend/.env"
  port=43210
fi

# ── 构建产物 ──────────────────────────────────────────
head_ "构建产物"
[ -d "$repo_root/node_modules" ]         && ok "前端 node_modules" "" || bad "前端 node_modules" "缺" "在仓库根跑 pnpm install"
[ -d "$repo_root/dist" ]                 && ok "dist" ""              || bad "dist" "缺" "NODE_OPTIONS=--max-old-space-size=3072 pnpm run build"
[ -d "$repo_root/backend/node_modules" ] && ok "后端 node_modules" "" || bad "后端 node_modules" "缺" "cd backend && pnpm install"
[ -f "$repo_root/backend/dist/api.js" ]  && ok "backend/dist" ""      || bad "backend/dist" "缺" "cd backend && pnpm build"

# ── 端口 ──────────────────────────────────────────────
head_ "端口"
probe() { curl -fsS --max-time 3 "http://127.0.0.1:$1$2" >/dev/null 2>&1; }
if probe "$port" /health; then ok "后端 $port" "/health 有应答"; else warn "后端 $port" "无应答" "bash deploy/termux/start.sh api"; fi
if probe 4173 /;         then ok "前端 4173" "有应答";        else warn "前端 4173" "无应答" "bash deploy/termux/start.sh web"; fi

# ── 资源 ──────────────────────────────────────────────
head_ "资源"
avail="$(df -h "$repo_root" 2>/dev/null | awk 'NR==2 {print $4}')"
ok "可用磁盘" "${avail:-未知}（构建 + 依赖约需 1GB）"
memkb="$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null)"
if [ -n "$memkb" ]; then
  memgb=$(( memkb / 1024 / 1024 ))
  if [ "$memgb" -ge 3 ]; then
    ok "可用内存" "约 ${memgb}GB"
  else
    warn "可用内存" "约 ${memgb}GB" "构建时 Rollup 要把 75 个 chunk 的模块图全放进 Node 堆，低内存会被 OOM 杀。用 NODE_OPTIONS=--max-old-space-size=3072，或改成在 PC 上构建再把 dist 传过来"
  fi
fi

# ── 汇总 ──────────────────────────────────────────────
printf '\n'
if [ ${#MISSING[@]} -eq 0 ]; then
  printf '\033[1;32m全部就绪。\033[0m'
  [ ${#NOTE[@]} -gt 0 ] && printf ' 有 %d 条提醒：\n' "${#NOTE[@]}" || printf '\n'
  for n in "${NOTE[@]:-}"; do [ -n "$n" ] && printf '  · %s\n' "$n"; done
  printf '\n下一步： termux-wake-lock  然后  bash deploy/termux/start.sh\n\n'
  exit 0
fi

printf '\033[1;31m缺 %d 项：\033[0m\n' "${#MISSING[@]}"
for m in "${MISSING[@]}"; do printf '  · %s\n' "$m"; done
if [ ${#NOTE[@]} -gt 0 ]; then
  printf '\n\033[33m另有 %d 条提醒：\033[0m\n' "${#NOTE[@]}"
  for n in "${NOTE[@]}"; do printf '  · %s\n' "$n"; done
fi
printf '\n补齐后重跑： bash deploy/termux/doctor.sh\n（或直接 bash deploy/termux/setup.sh，它会自动装缺的包）\n\n'
exit 1
