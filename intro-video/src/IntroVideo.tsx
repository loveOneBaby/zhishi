import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { SCENE_DURATIONS, TRANSITION } from "./theme";
import { Scene01Title } from "./scenes/Scene01Title";
import { Scene02Search } from "./scenes/Scene02Search";
import { Scene03Canvas } from "./scenes/Scene03Canvas";
import { Scene04Immersive } from "./scenes/Scene04Immersive";
import { Scene05Manage } from "./scenes/Scene05Manage";
import { Scene06AI } from "./scenes/Scene06AI";
import { Scene07Outro } from "./scenes/Scene07Outro";

const T = linearTiming({ durationInFrames: TRANSITION });

/**
 * 30s 主合成：7 段场景 + 6 段 fade 转场。
 * 总帧数 = Σ 场景帧 - 6×转场帧 = 990 - 90 = 900。
 */
export const IntroVideo: React.FC = () => (
  <AbsoluteFill style={{ background: "#edf4fb" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[0]}>
        <Scene01Title />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[1]}>
        <Scene02Search />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[2]}>
        <Scene03Canvas />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[3]}>
        <Scene04Immersive />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[4]}>
        <Scene05Manage />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[5]}>
        <Scene06AI />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[6]}>
        <Scene07Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
