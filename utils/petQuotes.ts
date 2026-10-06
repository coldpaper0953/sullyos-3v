// 桌宠统一台词库：从嗡嗡嗡 Android 版 Quotes.java 完整移植。
// 默认种子 + 用户编辑覆盖（localStorage），pick 支持 {n} {t} {name} 占位符。

const STORAGE_KEY = 'petdesk-quotes';

// 默认台词种子（与 Quotes.java DEF 一致）
const DEF: Record<string, string[]> = {
  // 基础交互
  tap: ['嗯？', '别闹…', '干嘛？', '戳啥呢'],
  throw: ['哎呀！', '你干什么！', '喂——'],
  revive: ['哼，我会复活的…你等着'],
  sleep: ['Zzz…', '好困…', '抱着挺舒服…'],
  fallback: ['嗡～信号不太好，等会儿再聊', '（信号弱）先自己玩会儿…', '嗡嗡…听不清，再说一遍？'],
  work_on: ['好嘞，进入工作状态！'],
  work_off: ['下班啦！'],
  glide: ['woooo～惯性滑翔！', '飞喽～～'],
  bounce: ['哎哟撞墙了…', '反弹～'],
  // 时段问候
  period_dawn: ['都凌晨了还不睡？！'],
  period_morning: ['早起的蚊子有血吸～早！'],
  period_am: ['上午好！今天打算干点什么？'],
  period_noon: ['中午啦，记得吃饭别糊弄～'],
  period_pm: ['下午好，起来活动活动～'],
  period_dusk: ['傍晚了，今天过得咋样？'],
  period_night: ['晚上好～放松一下吧'],
  period_late: ['都深夜了，早点睡！'],
  // 随机事件
  ev_ask: ['你觉得我可爱吗？诚实点！', '午饭吃的什么？别又是外卖…',
    '如果蚊子会许愿，你猜我许什么？', '你手机里这么多 App，最喜欢哪个？', '说！今天有没有想我（一点点也算）'],
  ev_story: ['我飞进过程序员的咖啡杯，差点被当 bug 修复…', '昨天我躲在耳机里听了一下午歌，白嫖！',
    '我见过凌晨四点的手机屏幕，比你亮。', '有一次差点被电蚊拍追杀，我学会了蛇皮走位。'],
  ev_mood: ['（突然有点emo）你说蚊子有朋友吗…', '今天莫名开心，想给你表演后空翻！',
    '哼，说不上来，就是有点小情绪。', '（原地转圈）开心！没理由的开心！'],
  // 小剧场场景（scene|A|B 一条三段）
  theater: [
    '你发现我半夜偷偷在你手机充电口旁边取暖|假装没看见|给我盖个小被子',
    '我在你屏幕上跳舞被卡组队邀请打断|让它继续跳|加入它一起跳',
    '我叼来一颗不知道哪来的糖放在你键盘上|收下并道谢|让它自己吃',
    '下雨天我淋湿了翅膀躲在状态栏里|用纸巾给它擦擦|让它自己晾干',
    '我宣布今天是我的生日（真的吗）|半信半疑地庆祝|戳穿并揉搓它',
  ],
  // 假报错（标题|内容）
  fake_error: [
    '系统错误|Mosquito.dll 内存溢出：检测到生物组织。点击确定释放蚊子。',
    '鼠标驱动异常|光标正在被吸血。建议立即拍打屏幕。',
    '磁盘空间不足|C:\\蚊子卵 文件夹占用 500GB。是否清理？',
    '网络连接中断|检测到蚊子翅膀震动干扰 WiFi 信号。',
    '杀毒软件警告|发现蚊群正在繁殖。建议物理清除。',
    '系统更新|Windows 防蚊补丁 KB666666 安装失败。',
    '蓝屏预警|蚊子密度超过阈值。系统将于 3 秒后蓝屏。',
    '摄像头占用|蚊子正在使用你的摄像头直播它的飞行。',
  ],
  // App 感知吐槽（类别|台词）
  appsense: [
    '办公|又在弄表格文档？记得随手保存！', '办公|工作工作，你的老板知道你这么努力吗～',
    '视频|老板！这里有人摸鱼看视频！', '视频|看完这集就去干活哦～',
    '聊天|又在偷偷跟谁聊天呢？', '聊天|聊什么呢聊这么开心～',
    '游戏|作业/工作写完了吗就打游戏？', '游戏|带我一个！我当飞行单位！',
    '音乐|🎵 跟着节奏动起来～',
    '购物浏览|又剁手了？蚊子我吃土就行', '购物浏览|逛逛逛，钱包还好吗～',
  ],
  // 教程（可编辑！）
  tutorial: [
    '嗡嗡～我飞到你手机上啦！',
    '点我一下＝戳戳（第一下我会说嗯？）',
    '连点三下会把我拍扁…我会复活的！',
    '按住 0.65 秒＝温柔摸头，长按 1.5 秒＝打开设置',
    '两根手指捏我＝放大缩小',
    '设置页里有手账/献血/专注/成就，慢慢玩～',
    '那就…多多关照啦！嗡嗡～',
  ],
  // 成就解锁
  achievement: ['🏆 解锁成就：{name}', '恭喜！{name} 达成～'],
  // 里程碑
  milestone: ['✨ 好感 {n} 里程碑达成！称号：{t}', '跨越 {n}！我们的羁绊变深了…'],
  // 饿/撑
  hungry: ['😩 饿扁了…快献血啦…', '🍽️ 有点饿了，献血吗？'],
  stuffed: ['呃……嗝……撑死了……'],
  // 主动搭话话题（Topic 池）
  topics: [
    '求摸摸：蹭到用户手边讨摸摸', '催喝水：提醒用户今天喝水了没',
    '炫耀：吹嘘自己刚才一个俯冲躲过了什么', '编一条蚊子冷知识讲给用户听',
    '问用户午饭打算吃什么', '抱怨手机屏幕太亮晃眼睛',
    '夸用户今天看起来状态不错', '好奇地问问用户在忙什么',
    '宣布自己要开始绕圈圈锻炼了', '问用户喜不喜欢下雨天的味道',
    '模仿手机通知声吓用户一跳', '感叹一下今天飞了多少圈',
    '提议用户起来伸个懒腰', '想听听用户今天遇到的开心事',
    '抱怨自己差点被风扇吹跑', '问用户觉得蚊子算不算最可爱的宠物',
    '宣布要给用户表演一个后空翻（虽然不会）',
  ],
};

let cache: Record<string, string[]> | null = null;

function ensure(): Record<string, string[]> {
  if (cache) return cache;
  cache = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) {
          const a = Array.isArray(o[k]) ? o[k].map((s: unknown) => String(s).trim()).filter(Boolean) : [];
          if (a.length) cache[k] = a;
        }
      }
    }
  } catch { /* ignore */ }
  return cache;
}

function persist(): void {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

/** 取某组台词（用户覆盖优先，否则回落默认种子） */
export function quotesGet(key: string): string[] {
  ensure();
  const l = cache![key];
  if (l && l.length) return l;
  const d = DEF[key];
  return d ? [...d] : [];
}

/** 随机抽一条 */
export function quotesPick(key: string, rnd: () => number = Math.random): string {
  const l = quotesGet(key);
  if (!l.length) return '嗡？';
  return l[Math.floor(rnd() * l.length)];
}

/** 带占位符替换：{n} {t} {name} */
export function quotesPickFmt(key: string, placeholders?: { n?: string; t?: string; name?: string }): string {
  let s = quotesPick(key);
  if (placeholders) {
    if (placeholders.n != null) s = s.split('{n}').join(placeholders.n);
    if (placeholders.t != null) s = s.split('{t}').join(placeholders.t);
    if (placeholders.name != null) s = s.split('{name}').join(placeholders.name);
  }
  return s;
}

/** App 感知吐槽：按「类别|台词」过滤后随机抽一条，该类别没有台词时返回 null */
export function appSenseLine(cat: string, rnd: () => number = Math.random): string | null {
  const lines = quotesGet('appsense')
    .filter(l => l.startsWith(cat + '|'))
    .map(l => l.slice(cat.length + 1).trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return lines[Math.floor(rnd() * lines.length)];
}

/** 保存用户覆盖 */
export function quotesSave(key: string, lines: string[]): void {
  ensure();
  cache![key] = lines.map(s => s.trim()).filter(Boolean);
  persist();
}

/** 全部重置为默认 */
export function quotesReset(): void {
  cache = {};
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** 全部可编辑组（含默认） */
export function quotesAll(): Record<string, string[]> {
  ensure();
  const r: Record<string, string[]> = {};
  for (const k of Object.keys(DEF)) {
    r[k] = quotesGet(k);
  }
  return r;
}

/** 编辑页显示名（与 Quotes.java label 一致） */
export function quotesLabel(key: string): string {
  const map: Record<string, string> = {
    tap: '戳击', throw: '被扔出', revive: '复活', sleep: '睡觉/勿扰', fallback: '网络异常兜底',
    work_on: '进入工作', work_off: '退出工作', glide: '惯性滑翔', bounce: '撞墙',
    ev_ask: '随机提问', ev_story: '讲故事', ev_mood: '心情波动',
    theater: '小剧场（场景|选项A|选项B）', fake_error: '伪造报错（标题|内容）',
    appsense: 'App吐槽（类别|台词）', tutorial: '新手教程（每行一步）',
    achievement: '成就解锁（{name}占位）', milestone: '好感里程碑（{n}{t}占位）',
    hungry: '肚子饿', stuffed: '吃撑打嗝', topics: '主动搭话话题库',
  };
  if (map[key]) return map[key];
  if (key.startsWith('period_')) return '时段问候：' + key.replace('period_', '');
  return key;
}
