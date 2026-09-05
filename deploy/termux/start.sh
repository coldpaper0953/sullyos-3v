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
  launch web node scripts/local-static-server.cjs dist
}

case "${1:-all}" in
  all)    start_pg; start_api; start_worker; start_web ;;
  pg)     start_pg ;;
  api)    start_pg; start_api ;;
  worker) start_pg; start_worker ;;
  web)    start_web ;;
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
