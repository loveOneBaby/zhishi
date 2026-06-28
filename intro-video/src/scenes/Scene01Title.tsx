import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { GlassBackground } from "../components/GlassBackground";
import { BrandMark } from "../components/BrandMark";
import { Wordmark } from "../components/Wordmark";
import { T, TYPE } from "../theme";
import { FONT_SANS } from "../fonts";
import { EASE, BACK, CLAMP, enter, rise } from "../motion";

/** 场1 · 开场：玻璃背景 + 品牌方块与 wordmark 回弹入场 + 副标题上推 */
export const Scene01Title: React.FC = () => {
  const f = useCurrentFrame();

  const markScale = interpolate(f, [8, 40], [0.4, 1], { ...CLAMP, easing: BACK });
  const markOpacity = enter(f, 8, 16);
  const title = rise(f, 30, 24, 30);
  const sub = rise(f, 54, 24, 24);
  const line = interpolate(f, [60, 92], [0, 220], { ...CLAMP, easing: EASE });

  return (
    <AbsoluteFill>
      <GlassBackground />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 40,
        }}
      >
        <div
          style={{
            opacity: markOpacity,
            scale: markScale,
          }}
        >
          <BrandMark size={132} />
        </div>

        <div style={{ ...title }}>
          <Wordmark size={TYPE.display} />
        </div>

        <div
          style={{
            height: 4,
            width: line,
            borderRadius: 4,
            background: T.brandGrad,
            opacity: enter(f, 60, 20),
          }}
        />

        <div
          style={{
            ...sub,
            fontFamily: FONT_SANS,
            fontSize: TYPE.body,
            fontWeight: 500,
            color: T.mut,
            letterSpacing: "0.04em",
          }}
        >
          面试知识 · 快速检索
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
