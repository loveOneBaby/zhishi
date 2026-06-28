import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { GlassBackground } from "../components/GlassBackground";
import { BrandMark } from "../components/BrandMark";
import { Wordmark } from "../components/Wordmark";
import { T, TYPE } from "../theme";
import { FONT_SANS } from "../fonts";
import { EASE, BACK, CLAMP, enter, rise } from "../motion";

/** 场7 · 收尾：回到品牌 + 副标题 + 技术栈，轻微缩放长保留后淡出 */
export const Scene07Outro: React.FC = () => {
  const f = useCurrentFrame();

  const markScale = interpolate(f, [0, 30], [0.5, 1], { ...CLAMP, easing: BACK });
  const title = rise(f, 10, 22, 26);
  const sub = rise(f, 30, 22, 22);
  const stack = rise(f, 50, 22, 18);
  // 整体结尾轻微缩放 + 淡出（最后 18 帧）
  const scale = interpolate(f, [70, 120], [1, 1.04], { ...CLAMP, easing: EASE });
  const opacity = interpolate(f, [102, 120], [1, 0], CLAMP);

  return (
    <AbsoluteFill>
      <GlassBackground />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 36,
          scale,
          opacity,
        }}
      >
        <div style={{ opacity: enter(f, 0, 16), scale: markScale }}>
          <BrandMark size={128} />
        </div>

        <div style={{ ...title }}>
          <Wordmark size={TYPE.display} />
        </div>

        <div
          style={{
            ...sub,
            fontFamily: FONT_SANS,
            fontSize: TYPE.body,
            fontWeight: 500,
            color: T.mut,
            letterSpacing: "0.03em",
          }}
        >
          面试知识 · 快速检索 · 开源可自部署
        </div>

        <div
          style={{
            ...stack,
            fontFamily: FONT_SANS,
            fontSize: TYPE.caption,
            fontWeight: 600,
            color: T.accent,
            letterSpacing: "0.02em",
          }}
        >
          React · Vite · TypeScript ｜ Express · SQLite · libSQL
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
