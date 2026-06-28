# 知识检索 · 30s 动画介绍

用 [Remotion](https://www.remotion.dev/) 制作的 30 秒项目介绍动画，视觉贴合产品的「毛玻璃 glass」主题。

- 合成：1920×1080，30fps，900 帧 = 30s
- 结构：7 段场景 + 6 段 fade 转场（`TransitionSeries`）
  1. 开场：品牌方块 + 「知识检索」wordmark
  2. 即时检索：拼音 `bibao` / 缩写 `scws` 打字机 → 结果卡
  3. 画布知识库：点阵网格 + 左→右树状卡片 + SVG 圆角折线逐条画出
  4. 沉浸 + 快捷键：全屏压暗 + F / ⌘K / 右⌘ / Esc 键帽卡
  5. 结构化索引 + 管理：多级树拖拽换位 + 已保存
  6. AI 问答：控制台实时生成日志 + 节点逐个滑入 + 闪烁光标
  7. 收尾：品牌 + 技术栈

## 目录

```
src/
├─ index.ts            registerRoot
├─ Root.tsx            <Composition id="IntroVideo" 1920×1080 30fps 900帧>
├─ IntroVideo.tsx      TransitionSeries 串接 7 场 + 6 fade
├─ theme.ts            glass 设计令牌 + 时间常量
├─ motion.ts           统一缓动 / 入场工具
├─ fonts.ts            Noto Sans SC 预加载 + 字体栈
├─ components/         GlassBackground / GlassPanel / BrandMark / Wordmark / Kbd / Eyebrow
└─ scenes/             Scene01Title … Scene07Outro
```

## 命令

```bash
npm install                 # 装依赖
npm run dev                 # 打开 Remotion Studio 预览
npm run render              # 渲染 out/intro.mp4（1920×1080，30s）
npx remotion still IntroVideo out/frame.png --frame=345 --scale=0.5   # 单帧快照
```

## 备注

- 中文用 Noto Sans SC（`@remotion/google-fonts` 预加载，每个渲染进程一次性拉取），栈里还列了 PingFang SC / Hiragino Sans GB / STHeiti 作本机兜底。
- 全程仅用 `interpolate` 驱动动画，未使用 CSS transition/animation。
- 不含音频；如需 BGM / 配音可后续在 `IntroVideo.tsx` 加 `<Audio>`。
