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

# 找出还活着的 sullyos 进程。用 PROC_DIR 变量而不是写死 /proc，
# 是为了能在桌面系统上模拟测试。
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

# 仓库被重 clone / 重装后 pid 文件没了，但 setsid 起的旧进程还活着——
# 揣着旧 APP_TOKEN（pair.sh 会 401）、占着端口（新进程 EADDRINUSE）。
# 按 pid 文件杀完之后，再按命令行特征扫一遍孤儿。
sweep_orphans() {
  local pats=('dist/api.js' 'dist/worker.js' 'local-static-server.cjs')
  local pat pid pids found=0
  for pat in "${pats[@]}"; do
    pids="$(list_sullyos_pids "$pat")" || true
    [ -n "$pids" ] || continue
    found=1
    say "扫尾：清掉孤儿进程（$pat）：$(echo $pids)"
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  done
  [ "$found" = 1 ] || return 0
  for _ in 1 2 3 4 5; do
    local left=0
    for pat in "${pats[@]}"; do
      [ -n "$(list_sullyos_pids "$pat")" ] && left=1
    done
    [ "$left" = 0 ] && return 0
    sleep 1
  done
  for pat in "${pats[@]}"; do
    pids="$(list_sullyos_pids "$pat")" || true
    for pid in $pids; do
      say "  $pid 还没退，KILL"
      kill -9 "$pid" 2>/dev/null || true
    done
  done
}

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
sweep_orphans

if [ "${1:-}" = "all" ]; then
  if pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
    say "停 postgres"
    pg_ctl -D "$pgdata" -m fast stop
  else
    say "postgres 没在跑"
  fi
fi

printf '\n已停。postgres %s\n' "$([ "${1:-}" = all ] && echo '已一并停止' || echo '仍在运行（bash deploy/termux/stop.sh all 可一并停）')"
