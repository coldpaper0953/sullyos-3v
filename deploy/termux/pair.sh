#!/data/data/com.termux/files/usr/bin/bash
# SullyOS · 生成一次性配对码，并打印一条「点开即自动填好」的链接
#
# 用法：bash deploy/termux/pair.sh
#
# 为什么需要这个：后端的配对流程假设你有两台设备——生成配对码的
# POST /v1/pairing-codes 要带 APP_TOKEN（backend/src/api.ts:36-37 的免鉴权白名单
# 里没有它），而设置面板里「生成配对码」那块又被「已有 token」门控住。
# 手机自己既是服务端又是唯一客户端时就死锁了。
#
# 这里由 shell 出面破局：它能直接读 backend/.env 里的 APP_TOKEN。
#
# 链接里放的是**码**而不是 token：码一次性、15 分钟过期，而 /v1/pair/exchange
# 本身免鉴权。APP_TOKEN 进了 URL 会留在浏览历史和截图里，而且它同时还是模型
# 密钥库的加密钥（backend/src/config.ts:39 的 modelVaultKey 未单独配置时复用它）。

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
env_file="$repo_root/backend/.env"

die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$env_file" ] || die "缺 backend/.env —— 先跑 bash deploy/termux/setup.sh"
command -v curl >/dev/null || die "没有 curl —— pkg install curl"

read_env() { # $1=key   取值并剥掉可能的引号与行尾空白
  grep -m1 "^$1=" "$env_file" 2>/dev/null | cut -d= -f2- | sed 's/\r$//; s/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

token="$(read_env APP_TOKEN)"
port="$(read_env PORT)"
port="${port:-43210}"
web_port="${WEB_PORT:-4173}"

[ -n "$token" ] || die "backend/.env 里的 APP_TOKEN 是空的 —— setup.sh 会自动生成，或者手填一个 ≥12 位的随机值"

base="http://127.0.0.1:${port}"

# 先探一下后端在不在，否则 curl 的报错对用户没有意义
if ! curl -fsS --max-time 5 "$base/health" >/dev/null 2>&1; then
  die "后端没有应答（$base/health）—— 先跑 bash deploy/termux/start.sh api"
fi

response="$(curl -fsS --max-time 10 -X POST "$base/v1/pairing-codes" \
  -H "Authorization: Bearer $token" 2>&1)" \
  || die "生成配对码失败。多半是 APP_TOKEN 与后端进程当前用的那个不一致（改过 .env 要重启：bash deploy/termux/stop.sh && bash deploy/termux/start.sh）。原始响应：$response"

# 只用 node 抽字段，不引入 jq 依赖（node 一定在，pnpm 就靠它）
code="$(printf '%s' "$response" | node -e '
  let raw = "";
  process.stdin.on("data", chunk => { raw += chunk; });
  process.stdin.on("end", () => {
    try {
      const parsed = JSON.parse(raw);
      process.stdout.write(String(parsed?.data?.code || ""));
    } catch {
      process.stdout.write("");
    }
  });
')"

[ -n "$code" ] || die "后端返回里没有配对码。原始响应：$response"

link="http://127.0.0.1:${web_port}/?backendPair=${code}"

printf '\n\033[1;32m配对码已生成（15 分钟内有效，用一次即失效）\033[0m\n\n'
printf '  \033[1;36m%s\033[0m\n\n' "$link"
cat <<EOF
在手机浏览器里点开上面这条链接：
  · 配对码会自动填进 设置 →「SullyOS 自主后端」的输入框
  · 面板会自动展开，你只要点一下「配对」

想手输的话，码是： $code

配对完记得点一次「完整同步角色、聊天与记忆宫殿」——以这台设备为权威快照
把数据推上后端。

EOF
