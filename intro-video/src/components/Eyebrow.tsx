import type { CSSProperties } from "react";
import { T, TYPE } from "../theme";
import { FONT_SANS } from "../fonts";

/** 场景眉头小标题（顶部一行点明本段主题） */
export const Eyebrow: React.FC<{
  children: React.ReactNode;
  style?: CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      fontFamily: FONT_SANS,
      fontSize: TYPE.h2,
      fontWeight: 600,
      color: T.mut,
      letterSpacing: "0.01em",
      lineHeight: 1.2,
      ...style,
    }}
  >
    {children}
  </div>
);
