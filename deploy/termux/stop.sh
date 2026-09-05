#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · Termux 停进程
#
# 用法：bash deploy/termux/stop.sh           # 停 api/worker/web，postgres 保留
#       bash deploy/termux/stop.sh all       # 连 postgres 一起停
#
# 刻意默认不停 postgres：它起得慢，而且日常只是重启 api/web。

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
run_dir="$repo_root/deploy/termux/run"
pgdata="$PREFIX/var/lib/postgresql"

say() { printf '\033[1;36m== %s\033[0m\n' "$*"; }

stop_one() { # $1=name
  local pidfile="$run_dir/$1.pid"
  if [ ! -f "$pidfile" ]; then
    say "$1 没有 pid 文件，跳过"
    return
  fi
  local pid
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    say "停 $1 (pid $pid)"
    # worker/api 都装了 SIGTERM handler（worker.ts:40-41），先温和地来
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$pid" 2>/dev/null && { say "$1 没退，KILL"; kill -9 "$pid" 2>/dev/null || true; }
  else
    say "$1 已经不在了"
  fi
  rm -f "$pidfile"
}

stop_one web
stop_one worker
stop_one api

if [ "${1:-}" = "all" ]; then
  if pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
    say "停 postgres"
    pg_ctl -D "$pgdata" -m fast stop
  else
    say "postgres 没在跑"
  fi
fi

printf '\n已停。postgres %s\n' "$([ "${1:-}" = all ] && echo '已一并停止' || echo '仍在运行（bash deploy/termux/stop.sh all 可一并停）')"
