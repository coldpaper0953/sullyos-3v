/**
 * 模型列表按「接口来源 + Key 指纹」缓存。
 *
 * 背景：availableModels 是全局单份，切换预设（换 baseUrl 或 Key）时列表不会跟着换，
 * 用户看到的永远是"最早在某个预设上刷新到的那份"。这里给每条「接口+Key」组合各存
 * 一份模型列表：刷新模型列表时写入，切换预设时读出，列表随预设走。
 *
 * 缓存键用 Key 的散列指纹而不是 Key 本身——模型名没有敏感性，密钥绝不落这份缓存。
 */

const CACHE_KEY = 'os_models_by_origin';

const originOf = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

// djb2 散列：只为区分不同的 Key，不需要密码学强度
const fingerprint = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
};

const cacheId = (baseUrl: string, apiKey: string): string =>
    `${originOf(baseUrl)}::${apiKey ? fingerprint(apiKey) : 'nokey'}`;

export function readModelsForOrigin(baseUrl: string, apiKey: string): string[] {
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        const list = cache[cacheId(baseUrl, apiKey)];
        return Array.isArray(list) ? list.filter(m => typeof m === 'string' && m.trim()) : [];
    } catch {
        return [];
    }
}

export function writeModelsForOrigin(baseUrl: string, apiKey: string, models: string[]): void {
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        cache[cacheId(baseUrl, apiKey)] = models;
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { /* ignore */ }
}
