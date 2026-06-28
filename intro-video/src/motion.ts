import { interpolate, Easing } from "remotion";

// 统一缓动
export const EASE = Easing.bezier(0.16, 1, 0.3, 1); // out-expo 感
export const BACK = Easing.bezier(0.34, 1.56, 0.64, 1); // 回弹

export const CLAMP = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

/** 0→1 的入场进度 */
export const enter = (f: number, start: number, dur = 18) =>
  interpolate(f, [start, start + dur], [0, 1], { ...CLAMP, easing: EASE });

/** 上推淡入：返回可展开到 style 的片段 */
export const rise = (f: number, start: number, dur = 20, dist = 28) => ({
  opacity: enter(f, start, dur),
  translate: `0px ${interpolate(f, [start, start + dur], [dist, 0], { ...CLAMP, easing: EASE })}px`,
});

/** 缩放淡入（带轻微回弹） */
export const pop = (f: number, start: number, dur = 26, from = 0.6) => ({
  opacity: interpolate(f, [start, start + dur * 0.6], [0, 1], CLAMP),
  scale: interpolate(f, [start, start + dur], [from, 1], { ...CLAMP, easing: BACK }),
});
