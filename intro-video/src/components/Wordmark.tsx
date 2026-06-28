import type { CSSProperties } from "react";
import { T, TYPE } from "../theme";
import { FONT_SANS } from "../fonts";

/** 产品名 wordmark「知识检索」 */
export const Wordmark: React.FC<{
  size?: number;
  weight?: number;
  color?: string;
  style?: CSSProperties;
}> = ({ size = TYPE.display, weight = 760, color = T.fg, style }) => (
  <span
    style={{
      fontFamily: FONT_SANS,
      fontSize: size,
      fontWeight: weight,
      color,
      letterSpacing: "-0.012em",
      lineHeight: 1,
      ...style,
    }}
  >
    知识检索
  </span>
);
