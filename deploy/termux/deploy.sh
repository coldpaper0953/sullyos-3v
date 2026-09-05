#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · Termux 一键部署
#
# 全新设备（一行）：
#   pkg install -y git && git clone https://github.com/coldpaper0953/sullyos-3v.git ~/sullyos && bash ~/sullyos/deploy/termux/deploy.sh
#
# 已经 clone 过：
#   cd ~/sullyos && git pull && bash deploy/termux/deploy.sh
#
# 干三件事：setup.sh 装环境建库构建 → start.sh 起服务 → pair.sh 打印配对链接。
# 三步都幂等，随时可以重复跑；中途失败修完再跑一遍就行，不用从头来。
#
# 非 root Android 没有 /usr/bin/env，所以 shebang 写 Termux bash 的绝对路径。

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"

banner() { printf '\n\033[1;35m########  %s  ########\033[0m\n' "$*"; }
warn()   { printf '\033[1;33m~~ %s\033[0m\n' "$*" >&2; }
die()    { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

case "$repo_root" in
  /storage/*|/sdcard/*)
    die "仓库在 $repo_root —— 共享存储没有 exec 权限也没有真实文件权限，pnpm 和 postgres 都会失败。挪到 ~ 下面再跑。"
    ;;
esac

# Doze 会在息屏几分钟后冻住后台进程，构建和心跳都受影响。
# 没装 Termux:API 就没有这个命令，不是致命问题，提醒一句继续走。
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || warn "termux-wake-lock 没拿到锁，息屏后进程可能被冻住"
else
  warn "没有 termux-wake-lock（需要装 Termux:API）。息屏一段时间后心跳会停，这是 Android 电源管理，代码管不了。"
fi

banner "1/3 初始化环境、数据库、依赖、构建"
bash "$repo_root/deploy/termux/setup.sh"

banner "2/3 启动 postgres / api / worker / 前端"
bash "$repo_root/deploy/termux/start.sh"

banner "3/3 生成配对链接"
# 起完 start.sh 里已经等过 /health 了，这里失败一般是配对端点有问题，
# 不该把整个部署判成失败——手动重跑 pair.sh 即可。
bash "$repo_root/deploy/termux/pair.sh" || warn "配对链接没生成出来，手动重跑：bash $repo_root/deploy/termux/pair.sh"

cat <<EOF

$(printf '\033[1;32m部署完成。\033[0m')

  前端      http://127.0.0.1:4173
  配对      点上面打印的 ?backendPair=... 链接，配对码会自动填好
  日志      $repo_root/deploy/termux/run/{api,worker,web}.log

以后每次开机只要这一行：

  termux-wake-lock; bash $repo_root/deploy/termux/start.sh

停：

  bash $repo_root/deploy/termux/stop.sh          # 留着 postgres
  bash $repo_root/deploy/termux/stop.sh all      # 连 postgres 一起停

想让角色自主活动，还要填 backend/.env 里的 MODEL_BASE_URL / MODEL_API_KEY /
MODEL_NAME（心跳调哪个模型），填完 bash $repo_root/deploy/termux/start.sh worker 重起。

EOF
