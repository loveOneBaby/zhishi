import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Minus, Plus } from "lucide-react";
import { GlassBackground } from "../components/GlassBackground";
import { GlassPanel } from "../components/GlassPanel";
import { Eyebrow } from "../components/Eyebrow";
import { T } from "../theme";
import { FONT_SANS } from "../fonts";
import { EASE, CLAMP, pop, rise } from "../motion";

const CW = 1420; // 内容区宽
const CH = 560; // 内容区高

type CardType = "root" | "folder" | "leaf";
type Card = {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  summary?: string;
  type: CardType;
  appear: number;
  selectAt?: number;
};

const ROOT: Card = {
  x: 0,
  y: 225,
  w: 260,
  h: 110,
  title: "前端",
  summary: "面试知识的结构化地图",
  type: "root",
  appear: 22,
};

const FOLDERS: Card[] = [
  { x: 430, y: 72, w: 220, h: 76, title: "JavaScript", type: "folder", appear: 44 },
  { x: 430, y: 242, w: 220, h: 76, title: "CSS", type: "folder", appear: 50 },
  { x: 430, y: 412, w: 220, h: 76, title: "框架", type: "folder", appear: 56 },
];

const LEAVES: Card[] = [
  { x: 820, y: 37, w: 220, h: 66, title: "闭包", summary: "词法作用域绑定", type: "leaf", appear: 76, selectAt: 128 },
  { x: 820, y: 117, w: 220, h: 66, title: "事件循环", summary: "宏任务 / 微任务", type: "leaf", appear: 82 },
  { x: 820, y: 207, w: 220, h: 66, title: "Flex 布局", summary: "一维弹性排列", type: "leaf", appear: 88 },
  { x: 820, y: 287, w: 220, h: 66, title: "层叠上下文", summary: "z-index 堆叠规则", type: "leaf", appear: 94 },
  { x: 820, y: 377, w: 220, h: 66, title: "React", summary: "声明式组件树", type: "leaf", appear: 100 },
  { x: 820, y: 457, w: 220, h: 66, title: "Vue", summary: "响应式数据驱动", type: "leaf", appear: 106 },
];

// 父右中 → 子左中的圆角正交折线
const connectorPath = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r = 12,
) => {
  const mx = (x1 + x2) / 2;
  if (y2 === y1) return `M ${x1} ${y1} H ${x2}`;
  const dir = y2 > y1 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `H ${mx - r}`,
    `Q ${mx} ${y1} ${mx} ${y1 + r * dir}`,
    `V ${y2 - r * dir}`,
    `Q ${mx} ${y2} ${mx + r} ${y2}`,
    `H ${x2}`,
  ].join(" ");
};

const EDGES: { d: string; appear: number }[] = [
  ...FOLDERS.map((fd, i) => ({
    d: connectorPath(260, 280, 430, [110, 280, 450][i]),
    appear: 44 + i * 6,
  })),
  // JavaScript(110) → 闭包(70), 事件循环(150)
  { d: connectorPath(650, 110, 820, 70), appear: 76 },
  { d: connectorPath(650, 110, 820, 150), appear: 82 },
  // CSS(280) → Flex(240), 层叠(320)
  { d: connectorPath(650, 280, 820, 240), appear: 88 },
  { d: connectorPath(650, 280, 820, 320), appear: 94 },
  // 框架(450) → React(410), Vue(490)
  { d: connectorPath(650, 450, 820, 410), appear: 100 },
  { d: connectorPath(650, 450, 820, 490), appear: 106 },
];

const CanvasCard: React.FC<{ c: Card; f: number }> = ({ c, f }) => {
  const dark = c.type === "root";
  const folder = c.type === "folder";
  const bg = dark ? T.fg : folder ? T.panelStrong : T.sel;
  const color = dark ? "#f7f9fc" : T.fg;
  const radius = dark ? 20 : folder ? 14 : 12;
  const shadow = dark ? T.shadowInk : T.shadowSoft;
  const selected = c.selectAt != null && f >= c.selectAt;
  const p = pop(f, c.appear, 24, 0.7);
  return (
    <div
      style={{
        position: "absolute",
        left: c.x,
        top: c.y,
        width: c.w,
        height: c.h,
        background: bg,
        color,
        borderRadius: radius,
        border: selected
          ? `2px solid ${T.accent}`
          : `1px solid ${dark ? "transparent" : T.bd}`,
        boxShadow: selected
          ? `0 0 0 5px ${T.accentSoft}, ${shadow}`
          : shadow,
        padding: "12px 18px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: "hidden",
        ...p,
      }}
    >
      {dark && (
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: "rgba(247,249,252,0.6)",
            marginBottom: 4,
          }}
        >
          INTERVIEW MAP
        </div>
      )}
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: dark ? 40 : folder ? 32 : 27,
          fontWeight: dark ? 760 : folder ? 700 : 600,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {c.title}
      </div>
      {c.summary && (
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: dark ? 20 : 18,
            fontWeight: 400,
            color: dark ? "rgba(247,249,252,0.66)" : T.mut,
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {c.summary}
        </div>
      )}
    </div>
  );
};

/** 场3 · 画布知识库：点阵网格 + 左→右树状卡片 + SVG 折线逐条画出 */
export const Scene03Canvas: React.FC = () => {
  const f = useCurrentFrame();
  const panelIn = {
    opacity: interpolate(f, [0, 16], [0, 1], CLAMP),
    scale: interpolate(f, [0, 18], [0.94, 1], { ...CLAMP, easing: EASE }),
  };

  return (
    <AbsoluteFill>
      <GlassBackground />
      <AbsoluteFill style={{ padding: "120px 200px", flexDirection: "column" }}>
        <div style={{ ...rise(f, 0, 20, 16) }}>
          <Eyebrow>每个分类，都是一个知识库</Eyebrow>
        </div>

        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: 20,
          }}
        >
          <GlassPanel
            strong
            blur={20}
            radius={20}
            style={{
              width: 1500,
              height: 640,
              padding: 40,
              position: "relative",
              overflow: "hidden",
              ...panelIn,
            }}
          >
            {/* 点阵网格底 */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: T.dotGrid,
                backgroundSize: "24px 24px",
                opacity: 0.55,
              }}
            />

            {/* 浮动控制条 */}
            <div
              style={{
                position: "absolute",
                top: 18,
                left: 18,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.7)",
                border: `1px solid ${T.glassBorder}`,
                boxShadow: T.shadowSoft,
                opacity: interpolate(f, [10, 26], [0, 1], CLAMP),
              }}
            >
              <span style={{ fontFamily: FONT_SANS, fontSize: 22, fontWeight: 740, color: T.fg }}>
                前端
              </span>
              <span style={{ fontFamily: FONT_SANS, fontSize: 20, color: T.mut }}>
                · 18 节点
              </span>
              <span style={{ width: 1, height: 20, background: T.bd }} />
              <Minus size={20} color={T.mut} strokeWidth={2.2} />
              <span style={{ fontFamily: FONT_SANS, fontSize: 18, color: T.mut, minWidth: 44, textAlign: "center" }}>
                100%
              </span>
              <Plus size={20} color={T.mut} strokeWidth={2.2} />
            </div>

            {/* 内容区：SVG 连线 + 卡片 */}
            <div style={{ position: "relative", width: CW, height: CH }}>
              <svg
                viewBox={`0 0 ${CW} ${CH}`}
                style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
              >
                {EDGES.map((e, i) => {
                  const off = interpolate(f, [e.appear, e.appear + 22], [1, 0], {
                    ...CLAMP,
                    easing: EASE,
                  });
                  return (
                    <path
                      key={i}
                      d={e.d}
                      fill="none"
                      stroke={T.bd}
                      strokeWidth={2}
                      pathLength={1}
                      strokeDasharray={1}
                      strokeDashoffset={off}
                    />
                  );
                })}
              </svg>

              <CanvasCard c={ROOT} f={f} />
              {FOLDERS.map((c) => (
                <CanvasCard key={c.title} c={c} f={f} />
              ))}
              {LEAVES.map((c) => (
                <CanvasCard key={c.title} c={c} f={f} />
              ))}
            </div>
          </GlassPanel>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
