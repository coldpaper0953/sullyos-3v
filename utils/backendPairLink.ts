/**
 * 单设备配对：把一次性配对码从 URL 接进来，自动填进设置面板的输入框。
 *
 * 为什么需要：后端的配对流程假设你有两台设备。`POST /v1/pairing-codes` 要带
 * APP_TOKEN 才能调（backend/src/api.ts:36-37 的免鉴权白名单里没有它），而设置面板
 * 里「生成配对码」那块又被 `config.token &&` 门控住。手机自己既是服务端又是唯一
 * 客户端时就死锁了：想拿码得先有 token，想有 token 得先拿码。
 *
 * 破法：让手机上持有 token 的那一方——shell——去生成码。deploy/termux/pair.sh
 * 从 backend/.env 读 token、调 /v1/pairing-codes，打印一条带码的地址。用户点开，
 * 这里把码暂存下来，BackendSettings 挂载时取出填进输入框，用户点一下「配对」。
 *
 * 刻意在 URL 里放码而不是 token：码是一次性的、15 分钟过期，而 /v1/pair/exchange
 * 本身免鉴权。APP_TOKEN 进了 URL 会留在浏览历史、截图和分享链接里，而它同时还是
 * 模型密钥库的加密钥（backend/src/config.ts:39 的 modelVaultKey 未单独配置时复用它）。
 *
 * 「读参数 → 消费 → replaceState 清掉」照的是 utils/activeMsgRuntime.ts 里
 * handleDeepLink 的既有范式，包括保留 history.state —— PhoneShell 的返回键守卫
 * 依赖它，传 null 会把返回键弄坏。
 */

/** 配对码参数名。`?backendPair=A1B2-C3D4-E5F6` */
export const BACKEND_PAIR_PARAM = 'backendPair';

/**
 * 暂存位置用 sessionStorage 而不是模块变量：设置页是懒加载的，点开链接后
 * BackendSettings 不会立刻挂载，中间还可能刷新一次。同标签页内有效，关掉即消失。
 */
const PENDING_KEY = 'sullyos_pending_pair_code';

/** 配对码形如 A1B2-C3D4-E5F6（backend/src/pairing.ts 的 createReadableCode）。 */
const CODE_SHAPE = /^[A-Za-z0-9-]{8,32}$/;

/**
 * 从一个 URL 里摘出配对码。纯函数。
 * 返回 null = 这条 URL 不带配对码，或码的形状不对。
 */
export function readPairCode(href: string): string | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    const raw = url.searchParams.get(BACKEND_PAIR_PARAM);
    if (!raw) return null;
    const code = raw.trim();
    // 形状不对就当没有：避免把任意 query 值塞进输入框，也挡住误拼的链接。
    if (!CODE_SHAPE.test(code)) return null;
    return code;
}

/**
 * 把配对码参数从 URL 上摘掉，path / hash / 其他 query 原样保留。纯函数。
 * 返回 null = 没有可清的东西（调用方据此决定是否要 replaceState）。
 */
export function stripPairParam(href: string): string | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    if (!url.searchParams.has(BACKEND_PAIR_PARAM)) return null;
    url.searchParams.delete(BACKEND_PAIR_PARAM);
    return url.toString();
}

/**
 * 启动时调一次。URL 上没有配对码就是零成本 no-op。
 *
 * 无论码有效与否都会把参数从地址栏抹掉——码是一次性的，留在 URL 里只会让用户
 * 刷新时反复撞「已失效」，还会把它带进收藏和截图。
 */
export function capturePairCodeFromUrl(): string | null {
    if (typeof window === 'undefined') return null;

    const code = readPairCode(window.location.href);
    if (code) {
        try {
            sessionStorage.setItem(PENDING_KEY, code);
        } catch {
            // 隐私模式下 sessionStorage 可能不可用；参数照样要清，用户可以手输那串码。
        }
    }

    const cleaned = stripPairParam(window.location.href);
    if (cleaned) {
        // 保留 history.state：PhoneShell 的返回键守卫靠它判断是不是同页导航。
        window.history.replaceState(window.history.state, '', cleaned);
    }
    return code;
}

/** 有没有待用的配对码（BackendSettings 用它决定要不要自动展开面板）。 */
export function hasPendingPairCode(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return Boolean(sessionStorage.getItem(PENDING_KEY));
    } catch {
        return false;
    }
}

/** 取出待用的配对码并清掉（只会被用一次）。 */
export function takePendingPairCode(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const code = sessionStorage.getItem(PENDING_KEY);
        if (code) sessionStorage.removeItem(PENDING_KEY);
        return code || null;
    } catch {
        return null;
    }
}
