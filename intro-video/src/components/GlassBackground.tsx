import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { T } from "../theme";
import { EASE, CLAMP } from "../motion";

type Orb = {
  color: string;
  size: number;
  x: number;
  y: number;
  drift: number;
  phase: number;
};

const DEFAULT_ORBS: Orb[] = [
  { color: "rgba(79,99,215,0.30)", size: 560, x: -140, y: -100, drift: 44, phase: 0 },
  { color: "rgba(111,125,237,0.22)", size: 480, x: 1380, y: 560, drift: 52, phase: 0.35 },
  { color: "rgba(150,195,225,0.28)", size: 400, x: 760, y: -140, drift: 34, phase: 0.7 },
  { color: "rgba(120,160,210,0.18)", size: 320, x: 360, y: 720, drift: 30, phase: 0.2 },
];

export const GlassBackground: React.FC<{
  orbs?: Orb[];
  dotGrid?: boolean;
  /** 0..1，沉浸时压暗背景 */
  dim?: number;
}> = ({ orbs = DEFAULT_ORBS, dotGrid = false, dim = 0 }) => {
  const frame = useCurrentFrame();
  // 慢速循环漂移（~13s 一周期）
  const t = interpolate(frame, [0, 400], [0, 1], { ...CLAMP, extrapolateRight: "extend", easing: EASE });

  return (
    <AbsoluteFill style={{ background: T.bg, overflow: "hidden" }}>
      {orbs.map((o, i) => {
        const dx = Math.sin((t + o.phase) * Math.PI * 2) * o.drift;
        const dy = Math.cos((t + o.phase) * Math.PI * 2) * o.drift * 0.7;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: o.x,
              top: o.y,
              width: o.size,
              height: o.size,
              borderRadius: "50%",
              background: o.color,
              filter: "blur(72px)",
              translate: `${dx}px ${dy}px`,
            }}
          />
        );
      })}
      {dotGrid && (
        <AbsoluteFill
          style={{
            backgroundImage: T.dotGrid,
            backgroundSize: "26px 26px",
            opacity: 0.5,
          }}
        />
      )}
      {dim > 0 && <AbsoluteFill style={{ background: "#0b1220", opacity: dim }} />}
    </AbsoluteFill>
  );
};
