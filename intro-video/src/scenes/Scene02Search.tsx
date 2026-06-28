import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Search } from "lucide-react";
import { GlassBackground } from "../components/GlassBackground";
import { GlassPanel } from "../components/GlassPanel";
import { Eyebrow } from "../components/Eyebrow";
import { T } from "../theme";
import { FONT_SANS } from "../fonts";
import { EASE, CLAMP, enter, rise } from "../motion";

type Result = {
  title: string;
  summary: string;
  kb: string;
  path: string;
};

const BIBAO: Result[] = [
  {
    title: "闭包",
    summary: "函数携带词法作用域，外部调用仍可访问外部变量",
    kb: "前端",
    path: "前端 / JavaScript",
  },
  {
    title: "闭包应用",
    summary: "模块化、私有变量、回调与防抖的底层机制",
    kb: "前端",
    path: "前端 / JavaScript",
  },
];

const SCWS: Result[] = [
  {
    title: "三次握手",
    summary: "TCP 建立连接的 SYN / SYN-ACK / ACK 三步",
    kb: "网络",
    path: "网络 / TCP",
  },
  {
    title: "四次挥手",
    summary: "TCP 断开连接的四步终止过程",
    kb: "网络",
    path: "网络 / TCP",
  },
];

const blink = (f: number) => (Math.floor(f / 14) % 2 === 0 ? 1 : 0.25);

const ResultCard: React.FC<{
  data: Result;
  f: number;
  appear: number;
  hide?: [number, number];
}> = ({ data, f, appear, hide }) => {
  const op = hide
    ? interpolate(
        f,
        [appear, appear + 14, hide[0], hide[1]],
        [0, 1, 1, 0],
        CLAMP,
      )
    : enter(f, appear, 16);
  const y = interpolate(f, [appear, appear + 14], [22, 0], {
    ...CLAMP,
    easing: EASE,
  });
  return (
    <GlassPanel
      blur={14}
      radius={14}
      style={{
        width: 1120,
        padding: "22px 28px 22px 32px",
        display: "flex",
        alignItems: "center",
        gap: 24,
        position: "relative",
        opacity: op,
        translate: `0px ${y}px`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 12,
          bottom: 12,
          width: 4,
          borderRadius: 4,
          background: T.accent,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 44,
            fontWeight: 700,
            color: T.fg,
            lineHeight: 1.15,
          }}
        >
          {data.title}
        </div>
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 28,
            fontWeight: 400,
            color: T.mut,
            marginTop: 6,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.summary}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        <span
          style={{
            fontFamily: FONT_SANS,
            fontSize: 24,
            fontWeight: 600,
            color: T.accent,
            background: T.accentSoft,
            border: `1px solid ${T.accentLine}`,
            borderRadius: 999,
            padding: "4px 14px",
          }}
        >
          {data.kb}
        </span>
        <span style={{ fontFamily: FONT_SANS, fontSize: 22, color: T.mut }}>
          {data.path}
        </span>
      </div>
    </GlassPanel>
  );
};

/** 场2 · 即时检索：打字机 bibao → 闭包；再 scws → 三次握手 */
export const Scene02Search: React.FC = () => {
  const f = useCurrentFrame();

  // 当前查询与显示文本
  let query = "";
  let results: { list: Result[]; appear: number; hide?: [number, number] } = {
    list: [],
    appear: 0,
  };

  if (f < 100) {
    // 第一段：bibao
    const typed = Math.round(
      interpolate(f, [16, 46], [0, "bibao".length], CLAMP),
    );
    query = "bibao".slice(0, Math.max(0, typed));
    results = { list: BIBAO, appear: 52, hide: [92, 100] };
  } else if (f < 108) {
    query = "";
    results = { list: [], appear: 0 };
  } else {
    const typed = Math.round(
      interpolate(f, [108, 136], [0, "scws".length], CLAMP),
    );
    query = "scws".slice(0, Math.max(0, typed));
    results = { list: SCWS, appear: 140 };
  }

  const box = rise(f, 0, 18, 18);

  return (
    <AbsoluteFill>
      <GlassBackground />
      <AbsoluteFill
        style={{
          padding: "150px 200px",
          flexDirection: "column",
        }}
      >
        <div style={{ ...rise(f, 0, 20, 16) }}>
          <Eyebrow>拼音 · 缩写 · 关键词，即时检索</Eyebrow>
        </div>

        <AbsoluteFill
          style={{
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            paddingBottom: 40,
          }}
        >
          {/* 搜索框 */}
          <GlassPanel
            blur={16}
            radius={16}
            style={{
              width: 1120,
              height: 96,
              padding: "0 30px",
              display: "flex",
              alignItems: "center",
              gap: 18,
              ...box,
            }}
          >
            <Search size={36} color={T.mut} strokeWidth={2.1} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
              {query ? (
                <span
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 40,
                    fontWeight: 600,
                    color: T.fg,
                    letterSpacing: "0.01em",
                  }}
                >
                  {query}
                  <span
                    style={{
                      display: "inline-block",
                      width: 3,
                      height: 38,
                      marginLeft: 6,
                      background: T.accent,
                      opacity: blink(f),
                      verticalAlign: "middle",
                    }}
                  />
                </span>
              ) : (
                <span
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 36,
                    fontWeight: 400,
                    color: T.mut,
                  }}
                >
                  搜索知识点（输入 / 选择知识库）
                </span>
              )}
            </div>
            <span
              style={{
                fontFamily: FONT_SANS,
                fontSize: 24,
                fontWeight: 600,
                color: T.accent,
                background: T.accentSoft,
                border: `1px solid ${T.accentLine}`,
                borderRadius: 999,
                padding: "6px 16px",
              }}
            >
              拼音 / 缩写
            </span>
          </GlassPanel>

          {/* 结果列表 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              alignItems: "center",
              minHeight: 280,
            }}
          >
            {results.list.map((r, i) => (
              <ResultCard
                key={r.title}
                data={r}
                f={f}
                appear={results.appear + i * 8}
                hide={results.hide}
              />
            ))}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
