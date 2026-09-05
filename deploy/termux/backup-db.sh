#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · Termux 原生数据库备份
#
# backend/scripts/backup-database.sh 全程走 docker compose exec，Termux 上没有
# Docker，所以这里直接调本机 pg_dump。
#
# 用法：bash deploy/termux/backup-db.sh [输出目录]
#       默认输出到 ~/sullyos-db-backups/
#
# 产出 .dump（custom 格式）+ 同名 .sha256。恢复：
#   pg_restore -d sullyos --clean --if-exists <文件>.dump

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
out_dir="${1:-$HOME/sullyos-db-backups}"
stamp="$(date +%Y%m%d-%H%M%S)"
target="$out_dir/sullyos-termux-$stamp.dump"

say() { printf '\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

command -v pg_dump >/dev/null || die "没有 pg_dump —— pkg install postgresql"
pg_isready -q || die "postgres 没在跑 —— bash deploy/termux/start.sh pg"

mkdir -p "$out_dir"

say "导出 sullyos → $target"
# custom 格式：能选择性恢复，也能压缩。注意 pg_dump 的大版本不能低于服务端，
# 同机备份不存在这个问题；跨机恢复时用低版本那端来 dump。
pg_dump --format=custom --no-owner --no-privileges -d sullyos -f "$target"

say "算校验和"
sha256sum "$target" | awk '{print $1}' >"$target.sha256"

size="$(du -h "$target" | cut -f1)"
cat <<EOF

完成：
  $target        ($size)
  $target.sha256

校验： sha256sum -c <(printf '%s  %s\n' "\$(cat '$target.sha256')" '$target')
恢复： pg_restore -d sullyos --clean --if-exists '$target'

提醒：这只备份后端数据库。前端的角色/聊天/记忆宫殿在浏览器 IndexedDB 里，
      要单独走设置页的「备份与恢复 (ZIP)」导出。
EOF
