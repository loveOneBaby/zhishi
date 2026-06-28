import { loadFont } from "@remotion/google-fonts/NotoSansSC";

// 预加载思源黑体：保证中文在任何渲染机都正常（每个渲染进程仅一次性拉取）。
// Latin 走系统 Helvetica；栈里再列系统 CJK 字体作兜底。
loadFont("normal", {
  weights: ["400", "600", "700", "800"],
  subsets: ["chinese-simplified", "latin"],
  ignoreTooManyRequestsWarning: true,
});

export const FONT_SANS =
  '"Helvetica Neue", Helvetica, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "STHeiti", Arial, sans-serif';
export const FONT_MONO =
  'ui-monospace, "SF Mono", "Noto Sans SC", "PingFang SC", Menlo, monospace';
