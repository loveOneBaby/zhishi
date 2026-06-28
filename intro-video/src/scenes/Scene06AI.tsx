import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Sparkles, FolderTree, FileText } from "lucide-react";
import { GlassBackground } from "../components/GlassBackground";
import { GlassPanel } from "../components/GlassPanel";
import { Eyebrow } from "../components/Eyebrow";
import { T } from "../theme";
import { FONT_SANS, FONT_MONO } from "../fonts";
import { EASE, CLAMP, enter, rise } from "../motion";

const LOGS = [
  { text: "解析意图", appear: 24 },
  { text: "生成结构", appear: 34 },
  { text: "写入知识库", appear: 44 },
];

const NODES = [
  { title: "闭包", folder: true, appear: 50 },
  { title: "作用域链", appear: 62 },
  { title: "立即执行函数", appear: 74 },
  { title: "this 指向", appear: 86 },
];

const blink = (f: number) => (Math.floor(f / 14) % 2 === 0 ? 1 : 0.25);

const LogLine: React.FC<{ text: string; appear: number; f: number }> = ({
  text,
  appear,
  f,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: enter(f, appear, 12) }}>
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 5,
        background: T.accent,
        flexShrink: 0,
      }}
    />
    <span style={{ fontFamily: FONT_MONO, fontSize: 28, color: T.mut }}>
      {text}
    </span>
  </div>
);

const GrowthNode: React.FC<{
  title: string;
  folder?: boolean;
  appear: number;
  f: number;
}> = ({ title, folder, appear, f }) => {
  const op = enter(f, appear, 14);
  const x = interpolate(f, [appear, appear + 14], [26, 0], {
    ...CLAMP,
    easing: EASE,
  });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        opacity: op,
        translate: `${x}px 0px`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          background: T.accentSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {folder ? (
          <FolderTree size={22} color={T.accent} strokeWidth={2.1} />
        ) : (
          <FileText size={22} color={T.accent} strokeWidth={2.1} />
        )}
      </div>
      <span
        style={{
          fontFamily: FONT_SANS,
          fontSize: 30,
          fontWeight: 600,
          color: T.fg,
        }}
      >
        {title}
      </span>
    </div>
  );
};

/** 场6 · AI 问答：控制台实时生成日志 + 节点逐个滑入 + 闪烁光标 */
export const Scene06AI: React.FC = () => {
  const f = useCurrentFrame();
  const dotPulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(f / 7));
  const caretOn = f >= 86;

  return (
    <AbsoluteFill>
      <GlassBackground />
      <AbsoluteFill style={{ padding: "120px 200px", flexDirection: "column" }}>
        <div style={{ ...rise(f, 0, 20, 16) }}>
          <Eyebrow>检索未命中？交给 AI</Eyebrow>
        </div>

        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: 30,
          }}
        >
          <GlassPanel
            blur={20}
            radius={18}
            style={{
              width: 1180,
              height: 560,
              padding: 36,
              ...rise(f, 0, 18, 18),
            }}
          >
            {/* 头部 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginBottom: 28,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 13,
                  background: T.sel,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Sparkles size={30} color={T.accent} strokeWidth={2.1} />
              </div>
              <span
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 42,
                  fontWeight: 820,
                  color: T.fg,
                }}
              >
                AI 控制台
              </span>
              <div style={{ flex: 1 }} />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 16px",
                  borderRadius: 999,
                  background: T.accentSoft,
                  border: `1px solid ${T.accentLine}`,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: T.accent,
                    opacity: dotPulse,
                  }}
                />
                <span
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 24,
                    fontWeight: 600,
                    color: T.accent,
                  }}
                >
                  Qwen · 运行中
                </span>
              </div>
            </div>

            {/* 主体两栏 */}
            <div style={{ display: "flex", gap: 40 }}>
              {/* 实时生成日志 */}
              <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 16 }}>
                <span
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 22,
                    fontWeight: 700,
                    color: T.mut,
                    letterSpacing: "0.1em",
                    marginBottom: 4,
                  }}
                >
                  实时生成
                </span>
                {LOGS.map((l) => (
                  <LogLine key={l.text} text={l.text} appear={l.appear} f={f} />
                ))}
              </div>

              {/* 实时写入节点 */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
                <span
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 22,
                    fontWeight: 700,
                    color: T.mut,
                    letterSpacing: "0.1em",
                    marginBottom: 4,
                  }}
                >
                  实时写入
                </span>
                {NODES.map((n) => (
                  <GrowthNode
                    key={n.title}
                    title={n.title}
                    folder={n.folder}
                    appear={n.appear}
                    f={f}
                  />
                ))}
                {/* 闪烁光标 */}
                <div
                  style={{
                    height: 30,
                    width: 3,
                    background: T.accent,
                    marginTop: 2,
                    opacity: caretOn ? blink(f) : 0,
                  }}
                />
              </div>
            </div>
          </GlassPanel>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
