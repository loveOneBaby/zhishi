import type { CSSProperties } from "react";
import { T } from "../theme";

/** 品牌方块：135° 蓝紫渐变 + 白光环 + 蓝色发光（复刻产品 .ik-brand-mark） */
export const BrandMark: React.FC<{ size?: number; style?: CSSProperties }> = ({
  size = 96,
  style,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: Math.max(8, size * 0.085),
      background: T.brandGrad,
      boxShadow: `0 0 0 ${size * 0.045}px rgba(255,255,255,0.55), 0 ${size * 0.07}px ${size * 0.18}px rgba(68,85,200,0.45)`,
      ...style,
    }}
  />
);
