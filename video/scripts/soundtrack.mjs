#!/usr/bin/env node
/*
 * Synthesises the film's soundtrack into public/soundtrack.wav: a 120 BPM
 * score with hits, whooshes, risers and UI blips placed on the picture.
 *
 * Nothing is sampled, so there is nothing to license and the file is
 * rebuilt the same every time (the noise is seeded). The scene cuts are read
 * from src/NoxIntro.tsx, so re-timing a scene there moves its music with it;
 * the hits inside a scene use that scene's own frame numbers, the same ones
 * its component animates on.
 *
 *   node scripts/soundtrack.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 48000;
const FPS = 30;
const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// --- the picture's timeline -------------------------------------------------

const source = readFileSync(join(root, "src/NoxIntro.tsx"), "utf8");
const scenes = [];
let cursor = 0;
for (const m of source.matchAll(/<TransitionSeries\.Sequence\s+name="([^"]+)"\s+durationInFrames=\{(\d+)\}/g)) {
  scenes.push({ name: m[1], start: cursor, frames: Number(m[2]) });
  cursor += Number(m[2]);
}
const TOTAL_FRAMES = cursor;
const DURATION = TOTAL_FRAMES / FPS;
const scene = (name) => {
  const s = scenes.find((x) => x.name === name);
  if (!s) throw new Error(`No scene named "${name}" in NoxIntro.tsx`);
  return s;
};
/** Seconds at a frame inside a scene. */
const at = (name, frame = 0) => (scene(name).start + frame) / FPS;
const cuts = scenes.slice(1).map((s) => s.start / FPS);

// --- buses -----------------------------------------------------------------

const N = Math.ceil(DURATION * SR);
const bus = () => [new Float32Array(N), new Float32Array(N)];
const drums = bus();
const music = bus();
const fx = bus();
const send = bus();
const side = new Float32Array(N);

let seed = 0x9e3779b9;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = () => rand() * 2 - 1;

const put = (b, i, v, pan = 0) => {
  if (i < 0 || i >= N) return;
  b[0][i] += v * Math.cos(((pan + 1) * Math.PI) / 4);
  b[1][i] += v * Math.sin(((pan + 1) * Math.PI) / 4);
};

/** Topology-preserving state-variable filter. */
class SVF {
  constructor() {
    this.a = 0;
    this.b = 0;
  }
  run(x, fc, q = 0.707) {
    const g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.b;
    const v1 = a1 * this.a + a2 * v3;
    const v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a;
    this.b = 2 * v2 - this.b;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  }
}

const polyblep = (t, dt) => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// --- instruments -------------------------------------------------------------

function kick(t, g = 1) {
  const s0 = Math.round(t * SR);
  let ph = 0;
  for (let i = 0; i < 0.5 * SR; i++) {
    const tt = i / SR;
    const f = 44 + 120 * Math.exp(-tt * 30);
    ph += (2 * Math.PI * f) / SR;
    const body = Math.tanh(Math.sin(ph) * Math.exp(-tt * 6.5) * 1.8);
    const click = noise() * Math.exp(-tt * 400) * 0.35;
    put(drums, s0 + i, (body + click) * 0.95 * g);
    const k = Math.exp(-tt * 8) * g;
    if (s0 + i < N && k > side[s0 + i]) side[s0 + i] = k;
  }
}

function clap(t, g = 1) {
  const s0 = Math.round(t * SR);
  const f = new SVF();
  for (let i = 0; i < 0.35 * SR; i++) {
    const tt = i / SR;
    const burst = tt < 0.03 ? Math.exp(-((tt % 0.0105) * 380)) : Math.exp(-(tt - 0.03) * 14);
    const v = f.run(noise(), 1500, 1.4).bp * burst * 1.6 * g;
    put(drums, s0 + i, v, 0.05);
    put(send, s0 + i, v * 0.35);
  }
}

function hat(t, g = 1, open = false, pan = 0.25) {
  const s0 = Math.round(t * SR);
  const f = new SVF();
  const len = open ? 0.3 : 0.06;
  for (let i = 0; i < len * SR; i++) {
    const tt = i / SR;
    const v = f.run(noise(), 8000, 0.9).hp * Math.exp(-tt * (open ? 11 : 60)) * 0.32 * g;
    put(drums, s0 + i, v, pan);
  }
}

function impact(t, g = 1) {
  const s0 = Math.round(t * SR);
  const f = new SVF();
  let ph = 0;
  for (let i = 0; i < 2.6 * SR; i++) {
    const tt = i / SR;
    const fr = 26 + 50 * Math.exp(-tt * 5);
    ph += (2 * Math.PI * fr) / SR;
    const sub = Math.tanh(Math.sin(ph) * Math.exp(-tt * 1.6) * 2.2) * 0.9;
    const crash = f.run(noise(), 200 + 9000 * Math.exp(-tt * 3.2), 0.6).lp * Math.exp(-tt * 2.6) * 0.8;
    const v = (sub + crash) * g;
    put(fx, s0 + i, v);
    put(send, s0 + i, crash * 0.8 * g);
    if (s0 + i < N) side[s0 + i] = Math.max(side[s0 + i], Math.exp(-tt * 3) * g);
  }
}

/** A short thud for stamps and slams. */
function thud(t, g = 1, pitch = 1) {
  const s0 = Math.round(t * SR);
  let ph = 0;
  const f = new SVF();
  for (let i = 0; i < 0.35 * SR; i++) {
    const tt = i / SR;
    ph += (2 * Math.PI * (70 + 160 * Math.exp(-tt * 40)) * pitch) / SR;
    const v = (Math.sin(ph) * Math.exp(-tt * 14) + f.run(noise(), 2400 * pitch, 0.8).bp * Math.exp(-tt * 40) * 0.9) * 0.8 * g;
    put(fx, s0 + i, v);
    put(send, s0 + i, v * 0.25);
  }
}

function whoosh(tEnd, dur = 0.5, g = 1, up = true) {
  const s0 = Math.round((tEnd - dur) * SR);
  const f = new SVF();
  const n = dur * SR;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const fc = up ? 300 * (8000 / 300) ** x : 8000 * (300 / 8000) ** x;
    const amp = Math.sin(Math.PI * x ** 1.4) ** 2;
    const v = f.run(noise(), fc, 1.8).bp * amp * 0.9 * g;
    put(fx, s0 + i, v, -0.8 + 1.6 * x);
    put(send, s0 + i, v * 0.3);
  }
}

function riser(t0, t1, g = 1) {
  const s0 = Math.round(t0 * SR);
  const n = Math.round((t1 - t0) * SR);
  const f = new SVF();
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const fc = 200 * (9000 / 200) ** x;
    ph += (2 * Math.PI * (110 * 2 ** (x * 3))) / SR;
    const v = (f.run(noise(), fc, 2.5).bp * 0.9 + Math.sin(ph) * 0.18) * x ** 2 * g;
    put(fx, s0 + i, v, Math.sin(x * 20) * 0.3);
    put(send, s0 + i, v * 0.3);
  }
}

/** Reverse swell: noise that grows into a point, for the implosions. */
function suck(t0, t1, g = 1) {
  const s0 = Math.round(t0 * SR);
  const n = Math.round((t1 - t0) * SR);
  const f = new SVF();
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const v = f.run(noise(), 6000 * (1 - x) + 300, 0.9).lp * x ** 3 * g;
    put(fx, s0 + i, v);
  }
}

function blip(t, freq, g = 1, pan = 0, decay = 9) {
  const s0 = Math.round(t * SR);
  let ph = 0;
  let mph = 0;
  for (let i = 0; i < 0.6 * SR; i++) {
    const tt = i / SR;
    mph += (2 * Math.PI * freq * 2) / SR;
    ph += (2 * Math.PI * freq) / SR + Math.sin(mph) * 0.3 * Math.exp(-tt * 30) * ((2 * Math.PI * freq) / SR);
    const v = Math.sin(ph) * Math.exp(-tt * decay) * 0.35 * g * Math.min(1, tt * 800);
    put(fx, s0 + i, v, pan);
    put(send, s0 + i, v * 0.6);
  }
}

function tick(t, g = 1, pan = 0) {
  const s0 = Math.round(t * SR);
  const f = new SVF();
  for (let i = 0; i < 0.02 * SR; i++) {
    const tt = i / SR;
    put(fx, s0 + i, f.run(noise(), 3500, 1.2).bp * Math.exp(-tt * 380) * 0.5 * g, pan);
  }
}

/** Digital interference: gated square bursts. */
function glitch(t, dur, g = 1) {
  const s0 = Math.round(t * SR);
  const n = Math.round(dur * SR);
  let ph = 0;
  let freq = 400;
  for (let i = 0; i < n; i++) {
    if (i % 1200 === 0) freq = 150 + rand() * 1800;
    const gate = Math.floor(i / 900) % 2 === 0 ? 1 : 0.15;
    ph = (ph + freq / SR) % 1;
    put(fx, s0 + i, (ph < 0.5 ? 0.18 : -0.18) * gate * g, (rand() - 0.5) * 0.8);
  }
}

function pad(t0, t1, notes, g = 1, cutoff = 1100) {
  const s0 = Math.round(t0 * SR);
  const n = Math.round((t1 - t0) * SR);
  const voices = notes.flatMap((m) => [-0.08, 0.08].map((d) => ({ f: hz(m + d), ph: rand() })));
  const fl = new SVF();
  const fr = new SVF();
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = Math.min(1, tt / 0.5) * Math.min(1, (n - i) / (0.6 * SR));
    let l = 0;
    let r = 0;
    voices.forEach((v, k) => {
      const dt = v.f / SR;
      v.ph = (v.ph + dt) % 1;
      const s = 2 * v.ph - 1 - polyblep(v.ph, dt);
      if (k % 2) r += s;
      else l += s;
    });
    const c = cutoff * (1 + 0.25 * Math.sin(tt * 1.3));
    const vl = fl.run(l, c, 0.8).lp * env * 0.07 * g;
    const vr = fr.run(r, c, 0.8).lp * env * 0.07 * g;
    if (s0 + i < N) {
      music[0][s0 + i] += vl;
      music[1][s0 + i] += vr;
      send[0][s0 + i] += vl * 0.4;
      send[1][s0 + i] += vr * 0.4;
    }
  }
}

function bass(t, dur, midi, g = 1, bright = 1) {
  const s0 = Math.round(t * SR);
  const n = Math.round(dur * SR);
  const f = new SVF();
  const dt = hz(midi) / SR;
  let ph = 0;
  let sub = 0;
  for (let i = 0; i < n + 0.02 * SR; i++) {
    const tt = i / SR;
    ph = (ph + dt) % 1;
    sub += 2 * Math.PI * dt;
    const saw = 2 * ph - 1 - polyblep(ph, dt);
    const env = Math.min(1, tt * 300) * (i < n ? 1 - 0.3 * Math.min(1, tt * 4) : Math.max(0, 1 - (i - n) / (0.02 * SR)));
    const v = (f.run(saw, (160 + 1400 * Math.exp(-tt * 16)) * bright, 1.1).lp * 0.55 + Math.sin(sub) * 0.45) * env * 0.5 * g;
    put(music, s0 + i, v);
  }
}

function pluck(t, midi, g = 1, pan = 0) {
  const s0 = Math.round(t * SR);
  const f = new SVF();
  const dt = hz(midi) / SR;
  let ph = rand();
  for (let i = 0; i < 0.3 * SR; i++) {
    const tt = i / SR;
    ph = (ph + dt) % 1;
    const saw = 2 * ph - 1 - polyblep(ph, dt);
    const v = f.run(saw, 400 + 4200 * Math.exp(-tt * 22), 1.2).lp * Math.exp(-tt * 9) * 0.16 * g;
    put(music, s0 + i, v, pan);
    put(send, s0 + i, v * 0.5, -pan);
  }
}

// --- the score -----------------------------------------------------------------

const A = 45; // A2
const PROG = [
  { root: 33, chord: [57, 60, 64] }, // Am
  { root: 29, chord: [53, 57, 60] }, // F
  { root: 36, chord: [60, 64, 67] }, // C
  { root: 31, chord: [55, 59, 62] }, // G
];

// 0:00 cold open — four slams out of warp, then the transmission types in
whoosh(at("Cold open", 34), 1.1, 0.9, false);
[0, 15, 30, 45].forEach((f, i) => {
  kick(at("Cold open", f), 1);
  impact(at("Cold open", f), i === 3 ? 0.9 : 0.45);
});
pad(at("Cold open", 45), at("Signal decay", 0), [A, A + 7, A + 12], 0.8, 500);
blip(at("Cold open", 72), 880, 0.7);
for (let f = 86; f < 126; f += 2) tick(at("Cold open", f), 0.5 + rand() * 0.5, (rand() - 0.5) * 0.6);
blip(at("Cold open", 126), 1318.5, 0.6);
blip(at("Cold open", 128), 1760, 0.5);
riser(at("Cold open", 112), at("Signal decay", 0), 0.7);
suck(at("Cold open", 132), at("Cold open", 142), 0.5);

// 0:05 signal decay — a half-time pulse; every handoff pings a little lower and dirtier
{
  const t0 = at("Signal decay");
  const tEnd = at("Signal decay", 312);
  for (let t = t0; t < tEnd - 0.01; t += BEAT) {
    const b = Math.round((t - t0) / BEAT);
    if (b % 2 === 0) kick(t, 0.85);
    if (b % 4 === 2) clap(t, 0.6);
    hat(t + BEAT / 2, 0.6);
    bass(t, BEAT / 2 - 0.02, 33, 0.8, 0.6);
    bass(t + BEAT / 2, BEAT / 2 - 0.02, b % 4 === 3 ? 36 : 33, 0.6, 0.6);
  }
  pad(t0, tEnd, [A, A + 3, A + 7], 0.6, 700);
  [15, 75, 135, 195, 255].forEach((f, k) => {
    blip(at("Signal decay", f), [880, 740, 622, 523, 440][k], 0.9);
    thud(at("Signal decay", f), 0.5);
    if (k > 0) glitch(at("Signal decay", f), 0.08 + k * 0.05, 0.5 + k * 0.15);
  });
  riser(at("Signal decay", 300), at("Signal decay", 345), 0.5);
  impact(at("Signal decay", 345), 0.8);
  kick(at("Signal decay", 345), 1);
  pad(at("Signal decay", 312), at("Chaos", 0), [A - 12, A, A + 3, A + 7], 0.9, 900);
}

// 0:18 chaos — four on the floor, tense and dirty
{
  const t0 = at("Chaos");
  const tQuiet = at("Chaos", 122);
  for (let t = t0; t < at("Chaos", 240) - 0.01; t += BEAT) {
    const b = Math.round((t - t0) / BEAT);
    const loud = t < tQuiet;
    kick(t, loud ? 1 : 0.7);
    if (b % 2 === 1 && loud) clap(t, 0.7);
    for (let k = 0; k < 4; k++) hat(t + (k * BEAT) / 4, k === 2 ? 0.9 : 0.45, k === 2 && loud);
    for (let k = 0; k < 4; k++) bass(t + (k * BEAT) / 4, BEAT / 4 - 0.02, k % 2 ? 45 : 33, 0.75, loud ? 1.4 : 0.8);
  }
  pad(t0, at("Missing map", 0), [A, A + 1, A + 7, A + 13], 0.7, 1300);
  [3, 33, 63].forEach((f) => impact(at("Chaos", f), 0.5));
  whoosh(at("Chaos", 124), 0.5, 0.6);
  impact(at("Chaos", 172), 0.6);
  glitch(at("Chaos", 172), 0.25, 0.9);
}

// 0:26 missing map — four words, four hits, then the implosion into silence
{
  [2, 17, 32, 47].forEach((f, i) => {
    kick(at("Missing map", f), 1);
    impact(at("Missing map", f), i === 3 ? 1 : 0.55);
  });
  glitch(at("Missing map", 60), 0.9, 0.5);
  riser(at("Missing map", 50), at("Missing map", 114), 1);
  suck(at("Missing map", 84), at("Missing map", 114), 0.9);
}

// 0:30 the drop — the full groove from here to the outro
const DROP = at("Reveal");
const GROOVE_END = at("Outro");
impact(DROP, 1.3);
{
  let bar = 0;
  for (let t = DROP; t < GROOVE_END - 0.01; t += BAR, bar++) {
    const c = PROG[bar % 4];
    const inReveal = t < at("Atlas");
    pad(t, t + BAR, c.chord, inReveal ? 1.1 : 0.8, inReveal ? 1500 : 1100);
    for (let b = 0; b < 4; b++) {
      const tb = t + b * BEAT;
      kick(tb, 1);
      if (b % 2 === 1) clap(tb, 0.9);
      for (let k = 0; k < 4; k++) hat(tb + (k * BEAT) / 4, [0.35, 0.6, 0.9, 0.6][k], k === 2, k % 2 ? 0.35 : 0.15);
      for (let k = 0; k < 2; k++) bass(tb + (k * BEAT) / 2, BEAT / 2 - 0.03, c.root + (k === 1 && b === 3 ? 12 : 0), 1, 1.2);
      if (t >= at("Atlas")) {
        const tones = [c.chord[0] + 12, c.chord[1] + 12, c.chord[2] + 12, c.chord[1] + 24];
        for (let k = 0; k < 4; k++) pluck(tb + (k * BEAT) / 4, tones[(b * 4 + k) % tones.length], 1, k % 2 ? 0.5 : -0.5);
      }
    }
  }
}
riser(at("Reveal", 190), at("Atlas"), 0.9);

// transitions — a whoosh into every cut after the drop, and a hit on it
cuts
  .filter((t) => t > DROP + 1)
  .forEach((t) => {
    whoosh(t, 0.45, 0.8);
    thud(t, 0.6);
  });

// features — the UI makes sounds where the picture moves
[30, 60, 90, 120].forEach((f, k) => blip(at("Knowledge", f), hz([72, 74, 76, 79][k]), 0.55, 0.3));
blip(at("Knowledge", 150), hz(84), 0.7);
blip(at("Knowledge", 150), hz(88), 0.5, -0.3);
[70, 115, 160, 205].forEach((f) => thud(at("Missions", f), 0.8, 1.2));
impact(at("Blast radius", 26), 0.6);
[38, 44, 50, 66, 72, 78].forEach((f, k) => blip(at("Blast radius", f), hz(57 - k), 0.6, (k % 2) - 0.5, 6));
thud(at("Blast radius", 140), 1, 0.8);
glitch(at("Blast radius", 140), 0.12, 0.6);
for (let f = 26; f < 42; f += 2) tick(at("Build", f), 0.8);
[50, 58, 66, 74, 82].forEach((f) => tick(at("Build", f), 1.2, 0.2));
blip(at("Build", 118), hz(79), 0.7);
blip(at("Build", 128), hz(84), 0.7);
[30, 60, 90, 120].forEach((f, k) => blip(at("Verify", f), hz([72, 76, 79, 84][k]), 0.8, 0.4 - k * 0.25));
[72, 76, 79, 84].forEach((m) => blip(at("Verify", 138), hz(m), 0.35));
for (let k = 0; k < 12; k++) blip(at("Verify", 166 + k * 2), hz(72 + k), 0.25);
[12, 19, 27, 34, 42, 49, 57, 64].forEach((f, k) => thud(at("Stack", f), 0.7, 1 + k * 0.08));
whoosh(at("Stack", 100), 0.8, 0.5);

// 1:26 outro — one last hit, the chord rings out, the star goes out
impact(GROOVE_END, 1.2);
kick(GROOVE_END, 1);
pad(GROOVE_END, DURATION, [A, A + 7, A + 12, A + 14, A + 19], 1.2, 1600);
bass(GROOVE_END, 2.5, 33, 0.8, 0.7);
suck(at("Outro", 96), at("Outro", 116), 0.7);
thud(at("Outro", 116), 0.7, 0.7);

// --- mix ---------------------------------------------------------------------

/** Freeverb-style room on the send bus. */
function reverb([inL, inR]) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => Math.round((d * SR) / 44100));
  const aps = [556, 441].map((d) => Math.round((d * SR) / 44100));
  const out = bus();
  [0, 1].forEach((ch) => {
    const input = ch ? inR : inL;
    const spread = ch ? 23 : 0;
    const cs = combs.map((d) => ({ buf: new Float32Array(d + spread), i: 0, store: 0 }));
    const as = aps.map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = input[n] * 0.02;
      let y = 0;
      for (const c of cs) {
        const o = c.buf[c.i];
        c.store = o * 0.75 + c.store * 0.25;
        c.buf[c.i] = x + c.store * 0.86;
        c.i = (c.i + 1) % c.buf.length;
        y += o;
      }
      for (const a of as) {
        const o = a.buf[a.i];
        a.buf[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = o - y;
      }
      out[ch][n] = y;
    }
  });
  return out;
}

const verb = reverb(send);
const L = new Float32Array(N);
const R = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const duck = 1 - 0.65 * Math.min(1, side[i]);
  const fade = Math.min(1, (N - i) / (0.4 * SR));
  L[i] = (drums[0][i] * 0.85 + music[0][i] * 0.9 * duck + fx[0][i] * 0.75 + verb[0][i] * 0.9) * fade;
  R[i] = (drums[1][i] * 0.85 + music[1][i] * 0.9 * duck + fx[1][i] * 0.75 + verb[1][i] * 0.9) * fade;
  L[i] = Math.tanh(L[i] * 1.1);
  R[i] = Math.tanh(R[i] * 1.1);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}

// --- write -----------------------------------------------------------------

const gain = 0.89 / peak;
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const out = join(root, "public/soundtrack.wav");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, data]));
console.log(`soundtrack: ${scenes.length} scenes, ${DURATION.toFixed(1)}s, ${(data.length / 1e6).toFixed(1)} MB → public/soundtrack.wav`);
