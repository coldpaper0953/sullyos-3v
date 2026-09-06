#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · Termux 一键热更新
#
# 用法：
#   bash deploy/termux/update.sh          # 拉最新代码，有更新才重建重启
#   bash deploy/termux/update.sh force    # 明明是最新也强制重建重启
#
# 干的活：git pull → 停 api/worker/web（postgres 保留）→ setup.sh（幂等：
# 装依赖、重建前后端、跑迁移）→ start.sh 起新版 → 健康检查。
# 复用 deploy 三件套，不在本脚本里重复任何一步。
#
# git pull 报超时/解析失败：九成是梯子的分流规则漏了 github.com——
# v2rayNG 类把路由切「全局」再跑一遍即可。
#
# 非 root Android 没有 /usr/bin/env，所以 shebang 写 Termux bash 的绝对路径。

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"

banner() { printf '\n\033[1;35m########  %s  ########\033[0m\n' "$*"; }
say()    { printf '\033[1;36m== %s\033[0m\n' "$*"; }
warn()   { printf '\033[1;33m~~ %s\033[0m\n' "$*" >&2; }
die()    { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

case "$repo_root" in
  /storage/*|/sdcard/*)
    die "仓库在 $repo_root —— 共享存储没有 exec 权限也没法构建。挪到 ~ 下面再跑。"
    ;;
esac

command -v git >/dev/null 2>&1 || die "git 没装：pkg install -y git"

# 构建要几分钟，先拿 wake-lock，防息屏 Doze 把构建/重启冻在半路。
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || warn "termux-wake-lock 没拿到锁，息屏后进程可能被冻住"
else
  warn "没有 termux-wake-lock（需要装 Termux:API）。构建中途别锁屏。"
fi

banner "1/4 拉取最新代码"
old_head="$(git -C "$repo_root" rev-parse HEAD)"
if ! git -C "$repo_root" pull --ff-only; then
  die "git pull 失败——超时/解析失败九成是梯子分流漏了 github.com，把 v2rayNG 切「全局」再跑一遍；也可能是本地改过已跟踪文件冲突，git stash 后重试。"
fi
new_head="$(git -C "$repo_root" rev-parse HEAD)"

if [ "$old_head" = "$new_head" ] && [ "${1:-}" != "force" ]; then
  say "已经是最新代码。顺手跑一遍 start.sh 自检（幂等，已在跑的不会动——上次更新半路失败的也能在这里被拉起来）"
  # 不直接 exit：上次重建失败会留下「代码最新但服务是停的」状态，走一遍幂等的
  # start.sh 正好自愈；服务都在跑时它只是打一遍健康检查，没有副作用。
  bash "$repo_root/deploy/termux/start.sh"
  exit 0
fi

banner "2/4 停旧进程（postgres 保留）"
bash "$repo_root/deploy/termux/stop.sh"

banner "3/4 重建依赖 / 前后端 / 数据库迁移（几分钟，别锁屏）"
bash "$repo_root/deploy/termux/setup.sh"

banner "4/4 启动新版"
bash "$repo_root/deploy/termux/start.sh"

# 顺手装超短命令（幂等）：up = 热更新（参数忽略，up 002 也行）；002 = 重启服务
make_short() { # $1=命令名 $2=脚本内容
  if printf '#!/data/data/com.termux/files/usr/bin/bash\n%s\n' "$2" > "$PREFIX/bin/$1" 2>/dev/null && chmod +x "$PREFIX/bin/$1" 2>/dev/null; then
    say "已装短命令: $1"
  else
    warn "短命令 $1 没装上（$PREFIX/bin 不可写），不影响更新"
  fi
}
make_short up "bash '$repo_root/deploy/termux/update.sh'"
make_short 002 "bash '$repo_root/deploy/termux/stop.sh'; bash '$repo_root/deploy/termux/start.sh'"

cat <<EOF

$(printf '\033[1;32m热更新完成。\033[0m')

  前端  http://127.0.0.1:4173 （浏览器里刷新一下页面就是新代码）
  日志  $repo_root/deploy/termux/run/{api,worker,web}.log
  以后更新直接输 up ，重启输 002

EOF
