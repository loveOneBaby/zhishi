import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { ChevronDown, FolderOpen, FileText, Check } from "lucide-react";
import { GlassBackground } from "../components/GlassBackground";
import { GlassPanel } from "../components/GlassPanel";
import { Eyebrow } from "../components/Eyebrow";
import { T, TYPE } from "../theme";
import { FONT_SANS } from "../fonts";
import { EASE, CLAMP, enter, rise } from "../motion";

type Row = {
  title: string;
  depth: number;
  folder?: boolean;
  count?: number;
};

const ROWS: Row[] = [
  { title: "前端", depth: 0, folder: true, count: 3 },
  { title: "JavaScript", depth: 1, folder: true, count: 3 },
  { title: "闭包", depth: 2 },
  { title: "事件循环", depth: 2 }, // 被拖拽，上移一位
  { title: "this 指向", depth: 2 },
];

const ROW_H = 84;
const DRAG = 30; // 开始拖拽
const SETTLE = 52; // 落位
const RELEASE = 60; // 松手

const TreeRow: React.FC<{
  row: Row;
  baseY: number;
  offsetY: number;
  f: number;
  appear: number;
  dragged: boolean;
}> = ({ row, baseY, offsetY, f, appear, dragged }) => {
  const lift = dragged
    ? interpolate(f, [DRAG, DRAG + 10, SETTLE], [1, 1.03, 1], {
        ...CLAMP,
        easing: EASE,
      })
    : 1;
  const isDrag = dragged && f >= DRAG && f <= RELEASE;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: baseY + offsetY,
        height: ROW_H,
        display: "flex",
        alignItems: "center",
        gap: 16,
        paddingLeft: 24 + row.depth * 40,
        paddingRight: 24,
        borderRadius: 12,
        background: row.folder ? "rgba(255,255,255,0.5)" : "transparent",
        border: isDrag ? `1px solid ${T.accentLine}` : "1px solid transparent",
        boxShadow: isDrag ? T.shadowLg : "none",
        scale: lift,
        zIndex: isDrag ? 6 : 1,
        opacity: enter(f, appear, 14),
      }}
    >
      {row.folder ? (
        <ChevronDown size={26} color={T.mut} strokeWidth={2.4} />
      ) : (
        <span style={{ width: 26 }} />
      )}
      {row.folder ? (
        <FolderOpen size={28} color={T.accent} strokeWidth={2.1} />
      ) : (
        <FileText size={26} color={T.mut} strokeWidth={2.1} />
      )}
      <span
        style={{
          fontFamily: FONT_SANS,
          fontSize: 32,
          fontWeight: row.folder ? 700 : 600,
          color: T.fg,
        }}
      >
        {row.title}
      </span>
      {row.count && (
        <span
          style={{
            fontFamily: FONT_SANS,
            fontSize: 22,
            color: T.mut,
            marginLeft: 6,
          }}
        >
          {row.count} 节点
        </span>
      )}
    </div>
  );
};

/** 场5 · 结构化索引 + 管理：多级树，拖拽「事件循环」上移换位，松手后已保存 */
export const Scene05Manage: React.FC = () => {
  const f = useCurrentFrame();

  // 拖拽行（index 3）上移一格，原位行（index 2）下移一格
  const offsetDragged = interpolate(f, [DRAG, SETTLE], [0, -ROW_H], {
    ...CLAMP,
    easing: EASE,
  });
  const offsetDisplaced = interpolate(f, [DRAG, SETTLE], [0, ROW_H], {
    ...CLAMP,
    easing: EASE,
  });

  const offsets = [0, 0, offsetDisplaced, offsetDragged, 0];

  return (
    <AbsoluteFill>
      <GlassBackground />
      <AbsoluteFill style={{ padding: "120px 200px", flexDirection: "column" }}>
        <div style={{ ...rise(f, 0, 20, 16) }}>
          <Eyebrow>结构化多级索引，拖拽即排序</Eyebrow>
        </div>

        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 28,
            paddingBottom: 30,
          }}
        >
          <GlassPanel
            blur={18}
            radius={18}
            style={{
              width: 1080,
              height: ROWS.length * ROW_H + 56,
              padding: "28px 24px",
              position: "relative",
              opacity: interpolate(f, [0, 16], [0, 1], CLAMP),
            }}
          >
            {/* 已保存提示 */}
            <div
              style={{
                position: "absolute",
                top: 22,
                right: 24,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 16px",
                borderRadius: 999,
                background: T.accentSoft,
                border: `1px solid ${T.accentLine}`,
                ...rise(f, 92, 18, 12),
              }}
            >
              <Check size={22} color={T.accent} strokeWidth={2.6} />
              <span
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 24,
                  fontWeight: 600,
                  color: T.accent,
                }}
              >
                已保存
              </span>
            </div>

            {ROWS.map((row, i) => (
              <TreeRow
                key={row.title}
                row={row}
                baseY={28 + i * ROW_H}
                offsetY={offsets[i]}
                f={f}
                appear={10 + i * 7}
                dragged={i === 3}
              />
            ))}
          </GlassPanel>

          <div
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE.caption,
              fontWeight: 500,
              color: T.mut,
              ...rise(f, 20, 18, 12),
            }}
          >
            增删 · 同级排序 · 多级索引 · 持久化到 SQLite
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
