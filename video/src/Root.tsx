import { Composition, Folder } from "remotion";
import "./lib/fonts";
import { NoxIntro } from "./NoxIntro";
import { Atlas } from "./scenes/Atlas";
import { BlastRadius } from "./scenes/BlastRadius";
import { Build } from "./scenes/Build";
import { Chaos } from "./scenes/Chaos";
import { ColdOpen } from "./scenes/ColdOpen";
import { Knowledge } from "./scenes/Knowledge";
import { MissingMap } from "./scenes/MissingMap";
import { Missions } from "./scenes/Missions";
import { Outro } from "./scenes/Outro";
import { Reveal } from "./scenes/Reveal";
import { SignalDecay } from "./scenes/SignalDecay";
import { Stack } from "./scenes/Stack";
import { Verify } from "./scenes/Verify";

/*
 * NoxIntro is the film. Each scene is also registered on its own, with the
 * same duration it has in the film, so it can be previewed and edited in
 * the Studio as a connected composition.
 */

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="NoxIntro" component={NoxIntro} durationInFrames={2700} fps={30} width={1920} height={1080} />
    <Folder name="NoxIntro-Scenes">
      <Composition id="ColdOpen" component={ColdOpen} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="SignalDecay" component={SignalDecay} durationInFrames={390} fps={30} width={1920} height={1080} />
      <Composition id="Chaos" component={Chaos} durationInFrames={240} fps={30} width={1920} height={1080} />
      <Composition id="MissingMap" component={MissingMap} durationInFrames={120} fps={30} width={1920} height={1080} />
      <Composition id="Reveal" component={Reveal} durationInFrames={240} fps={30} width={1920} height={1080} />
      <Composition id="Atlas" component={Atlas} durationInFrames={240} fps={30} width={1920} height={1080} />
      <Composition id="Knowledge" component={Knowledge} durationInFrames={210} fps={30} width={1920} height={1080} />
      <Composition id="Missions" component={Missions} durationInFrames={270} fps={30} width={1920} height={1080} />
      <Composition id="BlastRadius" component={BlastRadius} durationInFrames={180} fps={30} width={1920} height={1080} />
      <Composition id="Build" component={Build} durationInFrames={210} fps={30} width={1920} height={1080} />
      <Composition id="Verify" component={Verify} durationInFrames={210} fps={30} width={1920} height={1080} />
      <Composition id="Stack" component={Stack} durationInFrames={120} fps={30} width={1920} height={1080} />
      <Composition id="Outro" component={Outro} durationInFrames={120} fps={30} width={1920} height={1080} />
    </Folder>
  </>
);
