import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CutFlash, Grain, LightLeakOverlay } from "./components/Overlays";
import { rgba } from "./lib/color";
import { C } from "./lib/theme";
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
 * The 90-second NoX intro: 2700 frames at 30 fps.
 *
 *   0:00  Cold open        one sentence
 *   0:05  Signal decay     the handoffs lose it          ─┐
 *   0:18  Chaos            the estate nobody sees        ├ the problem
 *   0:26  Missing map      the root cause, the implosion ─┘
 *   0:30  Reveal           the drop: Project N☉X
 *   0:38  Atlas            the living map                ─┐
 *   0:46  Knowledge        every source, one KB           │
 *   0:53  Missions         four seats, one sentence       │
 *   1:02  Blast radius     the contract map at work       ├ the features
 *   1:08  Build            /nox and the coding agents     │
 *   1:15  Verify           in reverse, back to 100%       │
 *   1:22  Stack            built on Google               ─┘
 *   1:26  Outro
 *
 * Scenes are cut on the beat, with overlays over the cuts so the timeline
 * keeps its length. scripts/soundtrack.mjs reads the scene durations from
 * this file to place its hits, so keep each `durationInFrames` an inline
 * number.
 */

/** A thin progress rail along the bottom edge, like a flight path. */
const ProgressRail: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const p = frame / (durationInFrames - 1);
  return (
    <div style={{ position: "absolute", left: 0, top: height - 4, width, height: 4 }}>
      <div
        style={{
          width: width * p,
          height: 2,
          marginTop: 2,
          background: `linear-gradient(90deg, ${rgba(C.nox, 0.15)}, ${C.nox})`,
          boxShadow: `0 0 10px ${C.nox}`,
        }}
      />
    </div>
  );
};

export const NoxIntro: React.FC = () => (
  <AbsoluteFill style={{ background: C.void }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="Cold open" durationInFrames={150}>
        <ColdOpen />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="nox" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Signal decay" durationInFrames={390}>
        <SignalDecay />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="ember" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Chaos" durationInFrames={240}>
        <Chaos />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={10}>
        <CutFlash tone="ember" strength={0.7} />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Missing map" durationInFrames={120}>
        <MissingMap />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={50} offset={20}>
        <AbsoluteFill>
          <LightLeakOverlay seed={4} hueShift={345} />
          <CutFlash tone="nox" />
        </AbsoluteFill>
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Reveal" durationInFrames={240}>
        <Reveal />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={14}>
        <CutFlash tone="nox" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Atlas" durationInFrames={240}>
        <Atlas />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="ice" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Knowledge" durationInFrames={210}>
        <Knowledge />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="nox" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Missions" durationInFrames={270}>
        <Missions />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="ember" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Blast radius" durationInFrames={180}>
        <BlastRadius />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="ice" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Build" durationInFrames={210}>
        <Build />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="verify" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Verify" durationInFrames={210}>
        <Verify />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={12}>
        <CutFlash tone="ice" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Stack" durationInFrames={120}>
        <Stack />
      </TransitionSeries.Sequence>
      <TransitionSeries.Overlay durationInFrames={16}>
        <CutFlash tone="nox" />
      </TransitionSeries.Overlay>
      <TransitionSeries.Sequence name="Outro" durationInFrames={120}>
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    <Grain />
    <ProgressRail />
    <Audio src={staticFile("soundtrack.wav")} />
  </AbsoluteFill>
);
