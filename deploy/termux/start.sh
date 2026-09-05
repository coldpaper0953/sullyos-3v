#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · Termux 起三个进程：postgres → api → worker → 静态前端
#
# 用法：bash deploy/termux/start.sh          # 起全部
#       bash deploy/termux/start.sh api      # 只起某一个（api|worker|web）
#
# 幂等：已经在跑的不会重复起。日志和 pid 都落在 deploy/termux/run/ 下。

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
run_dir="$repo_root/deploy/termux/run"
pgdata="$PREFIX/var/lib/postgresql"
env_file="$repo_root/backend/.env"

mkdir -p "$run_dir"

say() { printf '\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

# 找出还活着的 sullyos 进程（配合 launch 清孤儿用）。
# PROC_DIR 是变量而不是写死 /proc，为了能在桌面系统上模拟测试。
PROC_DIR="${PROC_DIR:-/proc}"

list_sullyos_pids() { # $1=命令行匹配串；输出 pid，每行一个（不含自己）
  local self="$$" pid cmd d
  for d in "$PROC_DIR"/[0-9]*; do
    [ -r "$d/cmdline" ] || continue
    pid="${d##*/}"
    [ "$pid" = "$self" ] && continue
    # /proc 的 cmdline 是 NUL 分隔的，tr 成空格再匹配
    cmd="$(tr '\0' ' ' <"$d/cmdline" 2>/dev/null)" || continue
    case "$cmd" in *"$1"*) printf '%s\n' "$pid" ;; esac
  done
}

[ -f "$env_file" ] || die "缺 backend/.env —— 先跑 bash deploy/termux/setup.sh"

alive() { # $1=name
  local pidfile="$run_dir/$1.pid"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

launch() { # $1=name  $2..=命令
  local name="$1"; shift
  if alive "$name"; then
    say "$name 已在跑 (pid $(cat "$run_dir/$name.pid"))"
    return
  fi
  # pid 文件可能随仓库重 clone 丢了，但旧进程还活着占着端口——
  # 不清掉的话新进程 1 秒内 EADDRINUSE 死掉，这里还显示"起成功"。
  local pat orphans
  case "$name" in
    api)    pat='dist/api.js' ;;
    worker) pat='dist/worker.js' ;;
    web)    pat='local-static-server.cjs' ;;
    *)      pat='' ;;
  esac
  if [ -n "$pat" ]; then
    orphans="$(list_sullyos_pids "$pat")" || true
    if [ -n "$orphans" ]; then
      say "清掉 $name 的孤儿进程: $(echo $orphans)"
      kill $orphans 2>/dev/null || true
      sleep 1
      orphans="$(list_sullyos_pids "$pat")" || true
      [ -n "$orphans" ] && { kill -9 $orphans 2>/dev/null || true; sleep 1; }
    fi
  fi
  say "起 $name"
  # setsid + nohup：Termux 会话断开（切后台被回收）时进程不跟着走
  setsid nohup "$@" >>"$run_dir/$name.log" 2>&1 &
  echo $! >"$run_dir/$name.pid"
  sleep 1
  alive "$name" || die "$name 起失败，看 $run_dir/$name.log"
}

start_pg() {
  if pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
    say "postgres 已在跑"
  else
    say "起 postgres"
    pg_ctl -D "$pgdata" -l "$PREFIX/var/log/postgresql.log" start
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pg_isready -q && return
    sleep 1
  done
  die "postgres 没就绪，看 $PREFIX/var/log/postgresql.log"
}

start_api() {
  cd "$repo_root/backend"
  [ -f dist/api.js ] || die "缺 backend/dist —— 先在 backend/ 里跑 pnpm build"
  # --env-file 是关键：应用自己不读 .env（config.ts 直接 parse(process.env)）
  launch api node --env-file=.env dist/api.js
}

start_worker() {
  cd "$repo_root/backend"
  [ -f dist/worker.js ] || die "缺 backend/dist —— 先在 backend/ 里跑 pnpm build"
  launch worker node --env-file=.env dist/worker.js
}

start_web() {
  cd "$repo_root"
  [ -d dist ] || die "缺 dist/ —— 先跑 pnpm run build"
  if alive web; then
    say "web 已在跑 (pid $(cat "$run_dir/web.pid"))"
    return 1   # 没有新启动，调用方不用开浏览器
  fi
  say "起 web"
  setsid nohup node scripts/local-static-server.cjs dist >>"$run_dir/web.log" 2>&1 &
  echo $! >"$run_dir/web.pid"
  sleep 1
  alive web || die "web 起失败，看 $run_dir/web.log"
  # 等静态服务器真的在应答再返回，不然浏览器打开是个打不开的页面
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -fsS --max-time 2 "http://127.0.0.1:4173/" >/dev/null 2>&1 && return 0
    sleep 1
  done
  printf '静态服务器 10 秒内没应答，看 %s/web.log\n' "$run_dir" >&2
  return 1
}

open_browser() {
  local url="http://127.0.0.1:4173"
  if command -v termux-open >/dev/null 2>&1; then
    termux-open "$url" 2>/dev/null && { say "已在浏览器打开 $url"; return; }
  fi
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$url" 2>/dev/null && { say "已在浏览器打开 $url"; return; }
  fi
  say "浏览器没开出来（缺 termux-open，装 Termux:API 可解决），手动访问 $url"
}

case "${1:-all}" in
  # start_web 在 web 已在跑时返回 1（= 不用开浏览器），用 || true 兜住，
  # 否则 set -e 会把整个脚本在这里杀掉。
  all)    start_pg; start_api; start_worker; { start_web && open_browser; } || true ;;
  pg)     start_pg ;;
  api)    start_pg; start_api ;;
  worker) start_pg; start_worker ;;
  web)    { start_web && open_browser; } || true ;;
  *)      die "用法: bash deploy/termux/start.sh [all|pg|api|worker|web]" ;;
esac

printf '\n'
say "健康检查"
port="$(grep '^PORT=' "$env_file" | cut -d= -f2- | tr -d '[:space:]')"
port="${port:-43210}"
if curl -fsS "http://127.0.0.1:${port}/health" 2>/dev/null; then
  printf '\n'
else
  printf '后端 /health 还没应答，稍等几秒再试：curl http://127.0.0.1:%s/health\n' "$port"
fi

cat <<EOF

前端： http://127.0.0.1:4173
后端： http://127.0.0.1:${port}
日志： $run_dir/{api,worker,web}.log
停止： bash deploy/termux/stop.sh

别忘了 termux-wake-lock，否则 Doze 会把心跳进程冻住。
EOF
