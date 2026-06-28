import "./index.css";
import { Composition } from "remotion";
import { IntroVideo } from "./IntroVideo";
import { FPS, DURATION } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="IntroVideo"
      component={IntroVideo}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
