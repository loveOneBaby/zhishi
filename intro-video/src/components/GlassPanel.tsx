import type { CSSProperties } from "react";
import { T } from "../theme";

type Props = {
  blur?: number;
  strong?: boolean;
  radius?: number;
  style?: CSSProperties;
  children?: React.ReactNode;
};

/** 毛玻璃面板：半透白底 + 白边 + 蓝灰阴影 + 背景模糊 */
export const GlassPanel: React.FC<Props> = ({
  blur = 18,
  strong = false,
  radius = 16,
  style,
  children,
}) => (
  <div
    style={{
      background: strong ? T.panelStrong : T.panel,
      border: `1px solid ${T.glassBorder}`,
      boxShadow: T.shadow,
      backdropFilter: `blur(${blur}px) saturate(1.25)`,
      WebkitBackdropFilter: `blur(${blur}px) saturate(1.25)`,
      borderRadius: radius,
      ...style,
    }}
  >
    {children}
  </div>
);
