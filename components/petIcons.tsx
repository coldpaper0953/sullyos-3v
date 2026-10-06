/**
 * 桌宠面板图标 —— 纯白 ins 风：细线条矢量图标（Heroicons outline 风格）。
 * 统一 stroke="currentColor"、strokeWidth 1.5，颜色由调用处的 text-* 控制。
 */

import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({ size = 20, className = '', strokeWidth = 1.5, children }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={strokeWidth}
    stroke="currentColor"
    width={size}
    height={size}
    className={`inline-block shrink-0 ${className}`}
    style={{ verticalAlign: 'middle' }}
  >
    {children}
  </svg>
);

/* ── 心情表情（5 个）── */

export const FaceSmile: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.4 10.2h.01M15.6 10.2h.01" strokeWidth={2.2} strokeLinecap="round" />
    <path d="M8.5 14.4s1.1 1.9 3.5 1.9 3.5-1.9 3.5-1.9" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const FaceFrown: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.4 10.2h.01M15.6 10.2h.01" strokeWidth={2.2} strokeLinecap="round" />
    <path d="M8.5 15.8s1.1-1.7 3.5-1.7 3.5 1.7 3.5 1.7" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const FaceAngry: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7.2 9.5l2.2 1.4M16.8 9.5l-2.2 1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.6 16.2s1.2-1.3 3.4-1.3 3.4 1.3 3.4 1.3" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const FaceExcited: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.2 9.2l.9.9 1-.9M15 9.2l.9.9.9-.9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.4 14.8c.5 1.6 2.2 2.5 3.6 2.5s3.1-.9 3.6-2.5" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const FaceNeutral: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.4 10.2h.01M15.6 10.2h.01" strokeWidth={2.2} strokeLinecap="round" />
    <path d="M8.8 15.2h6.4" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/* ── 功能图标 ── */

export const IconHeart: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconDroplet: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3.5s6 6.7 6 10a6 6 0 1 1-12 0c0-3.3 6-10 6-10Z" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconSparkles: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M11 5l1.5 4L16.5 10.5 12.5 12 11 16 9.5 12 5.5 10.5 9.5 9 11 5Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconChat: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 4c-4.4 0-8 3.1-8 7 0 2.2 1.2 4.2 3.1 5.5L5 20l4.2-1.9c.9.2 1.8.3 2.8.3 4.4 0 8-3.1 8-7s-3.6-6.9-8-6.9Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);

export const IconClock: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 7v5l3.2 2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconMoon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7Z" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconBriefcase: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="7.5" width="17" height="12" rx="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.8 7.5V6a2 2 0 0 1 2-2h2.4a2 2 0 0 1 2 2v1.5M3.5 12.5h17" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconArrowUp: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 19V5m0 0l-6 6m6-6l6 6" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconTrophy: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M8 21h8M12 17v4M7.5 4h9v4a4.5 4.5 0 0 1-9 0V4Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7.5 5.5H4.8a1.8 1.8 0 0 0 0 3.6H7.5M16.5 5.5h2.7a1.8 1.8 0 0 1 0 3.6H16.5" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconBug: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <ellipse cx="12" cy="13.5" rx="4.2" ry="5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 8.5V5.5M12 5.5l-1.4-1.4M12 5.5l1.4-1.4M12 18.5v1.5M12 20l-1.4 1.4M12 20l1.4 1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 11.5 6.6 10M16 11.5l1.4-1.5M8 16l-1.4 1.5M16 16l1.4 1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconBook: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 6.2C10.1 4.6 7.4 4 4.5 4v13.8c2.9 0 5.6.6 7.5 2.2 1.9-1.6 4.6-2.2 7.5-2.2V4c-2.9 0-5.6.6-7.5 2.2ZM12 6.2V20" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconRefresh: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7M20 3v4h-4" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/* ── 根据心情名取表情图标 ── */
export const moodIcon = (m: string): React.FC<IconProps> => {
  switch (m) {
    case '开心': return FaceSmile;
    case '生气': return FaceAngry;
    case '孤独': return FaceFrown;
    case '兴奋': return FaceExcited;
    default: return FaceNeutral;
  }
};
