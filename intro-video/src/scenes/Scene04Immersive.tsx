import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { GlassBackground } from "../components/GlassBackground";
import { GlassPanel } from "../components/GlassPanel";
import { Eyebrow } from "../components/Eyebrow";
import { Kbd } from "../components/Kbd";
import { T, TYPE } from "../theme";
import { FONT_SANS } from "../fonts";
import { CLAMP, pop, rise } from "../motion";

type KbdCardDef = {
  keys: string[];
  label: string;
  note?: string;
  appear: number;
};

const CARDS: KbdCardDef[] = [
  { keys: ["F"], label: "进入沉浸", appear: 24 },
  { keys: ["⌘", "K"], label: "呼出搜索", appear: 46 },
  { keys: ["⌘"], label: "切换知识库", note: "右 Command 键", appear: 68 },
  { keys: ["Esc"], label: "退出", appear: 90 },
];

// 背景里隐约的画布节点，暗示「画布全屏接管」
const GHOSTS: { x: number; y: number; w: number; h: number; dark?: boolean }[] = [
  { x: 150, y: 360, w: 260, h: 110, dark: true },
  { x: 1500, y: 300, w: 220, h: 70 },
  { x: 1180, y: 620, w: 220, h: 70 },
];

const KbdCard: React.FC<{ c: KbdCardDef; f: number }> = ({ c, f }) => {
  const p = pop(f, c.appear, 26, 0.6);
  return (
    <GlassPanel
      blur={18}
      radius={16}
      style={{
        width: 420,
        height: 172,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        ...p,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {c.keys.map((k, i) => (
          <Kbd key={i} size={58}>
            {k}
          </Kbd>
        ))}
      </div>
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: TYPE.h2,
          fontWeight: 600,
          color: T.fg,
        }}
      >
        {c.label}
      </div>
      {c.note && (
        <div style={{ fontFamily: FONT_SANS, fontSize: 24, color: T.mut }}>
          {c.note}
        </div>
      )}
    </GlassPanel>
  );
};

/** 场4 · 沉浸 + 快捷键：画布全屏压暗 + 四张键帽卡依次回弹弹出 */
export const Scene04Immersive: React.FC = () => {
  const f = useCurrentFrame();
  const dim = interpolate(f, [0, 24], [0, 0.32], CLAMP);

  return (
    <AbsoluteFill>
      <GlassBackground dotGrid dim={dim} />
      {/* 隐约的画布节点 */}
      {GHOSTS.map((g, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: g.x,
            top: g.y,
            width: g.w,
            height: g.h,
            borderRadius: g.dark ? 20 : 14,
            background: g.dark ? T.fg : T.panelStrong,
            border: `1px solid ${T.bd}`,
            boxShadow: T.shadowSoft,
            opacity: interpolate(f, [0, 24], [0, 0.22], CLAMP),
          }}
        />
      ))}

      <AbsoluteFill style={{ padding: "120px 200px", flexDirection: "column" }}>
        <div style={{ ...rise(f, 0, 20, 16) }}>
          <Eyebrow>沉浸模式，键盘如飞</Eyebrow>
        </div>

        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "420px 420px",
              gridTemplateRows: "172px 172px",
              gap: 28,
            }}
          >
            {CARDS.map((c) => (
              <KbdCard key={c.label} c={c} f={f} />
            ))}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
