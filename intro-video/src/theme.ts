// 毛玻璃 glass 主题设计令牌（取自产品 web/src/themes.ts 与 styles/theme.css）
// 以及 30s 合成的时间常量。

export const FPS = 30;
export const DURATION = 900; // 30s
export const TRANSITION = 15; // 每段 fade 帧数

// 各场帧数：sum = 990，减去 6 段转场 ×15 = 90 → 900 帧
export const SCENE_DURATIONS = [120, 165, 165, 150, 150, 120, 120] as const;

export const T = {
  bg: "linear-gradient(135deg,#edf4fb 0%,#f8fafc 42%,#edf8f6 100%)",
  fg: "#172033",
  mut: "#647086",
  accent: "#4f63d7",
  accentInk: "#ffffff",
  accentSoft: "rgba(79,99,215,0.10)",
  accentLine: "rgba(79,99,215,0.35)",
  danger: "#e23d47",
  panel: "rgba(255,255,255,0.72)",
  panelStrong: "rgba(255,255,255,0.88)",
  sel: "rgba(255,255,255,0.58)",
  bd: "rgba(111,127,156,0.22)",
  bdStrong: "rgba(111,127,156,0.34)",
  glassBorder: "rgba(255,255,255,0.64)",
  shadowSoft: "0 8px 28px rgba(40,54,82,0.07)",
  shadow: "0 18px 46px rgba(40,54,82,0.10)",
  shadowLg: "0 26px 60px rgba(40,54,82,0.16)",
  shadowInk: "0 22px 50px rgba(0,0,0,0.18)",
  brandGrad: "linear-gradient(135deg,#4455c8,#6f7ded)",
  dotGrid: "radial-gradient(rgba(111,127,156,0.22) 1px, transparent 1px)",
  ink: "#0d0d0f",
} as const;

// 1920×1080 合成的字号阶梯（最小可读距离已放大）
export const TYPE = {
  display: 150, // 主 wordmark
  h1: 74, // 场景主标题
  h2: 56, // 次级
  body: 44, // 正文 / 副标题
  caption: 34, // 标签
  micro: 26, // 装饰性小字
} as const;
