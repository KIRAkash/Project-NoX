import { Easing, interpolate, random } from "remotion";

/*
 * Timing for the whole film. The soundtrack runs at 120 BPM, which at 30 fps
 * is one beat every 15 frames and one bar every 60. Every scene starts on a
 * beat, so a scene's own frame counter stays in phase with the music.
 */

export const FPS = 30;
export const BEAT = 15;
export const BAR = 60;

export const ease = {
  /** fast start, long settle: the default for anything arriving */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** slow start, fast finish: for anything leaving */
  in: Easing.bezier(0.7, 0, 0.84, 0),
  inOut: Easing.bezier(0.87, 0, 0.13, 1),
  soft: Easing.bezier(0.45, 0, 0.55, 1),
  /** a small overshoot */
  back: Easing.bezier(0.34, 1.56, 0.64, 1),
};

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 → 1 between frames a and b. */
export const prog = (f: number, a: number, b: number, easing: (t: number) => number = ease.out) =>
  interpolate(f, [a, b], [0, 1], { ...CLAMP, easing });

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Rises 0 → 1 over [a, b], holds, falls back to 0 over [c, d]. */
export const envelope = (f: number, a: number, b: number, c: number, d: number) =>
  Math.min(prog(f, a, b, ease.out), 1 - prog(f, c, d, ease.in));

/** 1 on every beat, decaying before the next one. */
export const pulse = (f: number, period = BEAT, decay = 4) => {
  if (f < 0) return 0;
  return Math.exp(-(f % period) / decay);
};

/** A decaying camera shake after each hit frame. */
export const shake = (f: number, hits: number[], amp = 14, len = 12) => {
  let x = 0;
  let y = 0;
  for (const h of hits) {
    const d = f - h;
    if (d < 0 || d > len) continue;
    const k = amp * (1 - d / len) ** 2;
    x += (random(`shake-x-${h}-${d}`) - 0.5) * 2 * k;
    y += (random(`shake-y-${h}-${d}`) - 0.5) * 2 * k;
  }
  return { x, y };
};

/** Sum of a per-frame speed up to frame f: how far something moving at that speed has travelled. */
export const travelled = (f: number, speedAt: (frame: number) => number) => {
  let t = 0;
  for (let i = 0; i < Math.floor(f); i++) t += speedAt(i);
  return t + speedAt(Math.floor(f)) * (f - Math.floor(f));
};
