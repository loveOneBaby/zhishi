import { T } from "../theme";
import { FONT_SANS } from "../fonts";

/** 键帽：白底圆角 + 底部立体阴影（产品本身无可见键帽，视频补上） */
export const Kbd: React.FC<{ children: React.ReactNode; size?: number }> = ({
  children,
  size = 44,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: size,
      height: size,
      padding: `0 ${size * 0.28}px`,
      fontFamily: FONT_SANS,
      fontSize: size * 0.46,
      fontWeight: 700,
      color: T.fg,
      background: "rgba(255,255,255,0.92)",
      border: "1px solid rgba(111,127,156,0.3)",
      borderRadius: 10,
      boxShadow:
        "0 3px 0 rgba(111,127,156,0.28), 0 6px 14px rgba(40,54,82,0.1)",
    }}
  >
    {children}
  </span>
);
