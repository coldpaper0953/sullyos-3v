// 桌宠融合版「检查更新」：拉 wwww 仓库的 Release，剥前缀比版本号取最高。
// 从嗡嗡嗡 Android 版 checkUpdate 移植（GitHub Release 不保证按版本号排序，必须遍历取最高）。

export const PET_VERSION = '3.1.0'; // 当前融合版版本号（发版时同步改）

const REPO = 'coldpaper0953/wwwww';
const TAG_PREFIX = 'sullyos-v';

export interface UpdateInfo {
  tag: string;
  name: string;
  notes: string;
  url: string;
}

function parseVer(v: string): number[] {
  return v.split('.').map(s => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** a > b ? 1 : a < b ? -1 : 0 */
function cmpVer(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 检查更新：返回更高版本的 Release，已是最新则 null */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const releases: any[] = await res.json();
    if (!Array.isArray(releases)) return null;

    let best: UpdateInfo | null = null;
    let bestVer: number[] = parseVer(PET_VERSION);

    for (const r of releases) {
      const tag: string = r?.tag_name || '';
      if (!tag.startsWith(TAG_PREFIX)) continue;
      const v = tag.slice(TAG_PREFIX.length).replace(/^v/, '');
      const ver = parseVer(v);
      if (cmpVer(ver, bestVer) > 0) {
        bestVer = ver;
        best = {
          tag,
          name: r.name || tag,
          notes: (r.body || '').slice(0, 4000),
          url: r.html_url || `https://github.com/${REPO}/releases/tag/${tag}`,
        };
      }
    }

    if (!best || cmpVer(bestVer, parseVer(PET_VERSION)) <= 0) return null;
    return best;
  } catch {
    return null;
  }
}
