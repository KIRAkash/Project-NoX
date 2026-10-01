// Timeline engine: one paused GSAP master timeline, per-frame hooks, sound cues and
// motion-blur zones. window.renderFrame(t) is a pure function of t.
/* global gsap, SplitText, ScrambleTextPlugin, DrawSVGPlugin, CustomEase */
gsap.registerPlugin(SplitText, ScrambleTextPlugin, DrawSVGPlugin, CustomEase);
gsap.ticker.lagSmoothing(0);

export const DUR = 90;
export const tl = gsap.timeline({ paused: true, defaults: { ease: "expo.out" } });
export const hooks = [];
export const cues = [];
export const blurZones = [];
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));

// house eases
CustomEase.create("swift", "0.16,1,0.3,1");        // fast start, long settle
CustomEase.create("whip", "0.7,0,0.2,1");          // whip pans
CustomEase.create("anticip", "0.5,-0.25,0.3,1");   // a little pull-back before the move

export const cue = (type, t, extra = {}) => cues.push({ type, t: +t.toFixed(3), ...extra });
/** frames inside [t0, t1] get n motion-blur subframes */
export const blur = (t0, t1, n = 6) => blurZones.push([t0, t1, n]);
export const blurAt = (t) => { let n = 1; for (const [a, b, k] of blurZones) if (t >= a && t <= b) n = Math.max(n, k); return n; };

/* ---------------- deterministic randomness ---------------- */
export function hash(a, b = 0) { let h = (a * 374761393 + b * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let frameRand = rng(1);
Math.random = () => frameRand();
export function seedFrame(t) { frameRand = rng(Math.floor(t * 30 + 0.5) * 7919 + 17); }

/* ---------------- colour ---------------- */
export const HEX = {
  nox: "#F7B542", ember: "#E9713C", ice: "#86B9EE", verify: "#5FD29F", red: "#FF5D6C",
  biz: "#E8C97A", po: "#A897F0", eng: "#5FCBD8", dev: "#86B9EE",
};

/* ---------------- tween helpers ---------------- */
export function sceneIn(sel, t, d = 0.5) { tl.fromTo(sel, { autoAlpha: 0 }, { autoAlpha: 1, duration: d, ease: "power1.out" }, t); }
export function sceneOut(sel, t, d = 0.4) { tl.to(sel, { autoAlpha: 0, duration: d, ease: "power1.in" }, t); }
export function setOff(sel, t) { tl.set(sel, { autoAlpha: 0 }, t); }

/** words rise out of a mask, one after another */
export function maskWords(el, t, { stagger = 0.06, d = 0.9, y = 110 } = {}) {
  const st = new SplitText(el, { type: "lines,words", mask: "lines" });
  tl.fromTo(st.words, { yPercent: y, rotate: 4 }, { yPercent: 0, rotate: 0, duration: d, ease: "expo.out", stagger }, t);
  tl.set(el, { autoAlpha: 1 }, t);
  gsap.set(el, { autoAlpha: 0 });
  return st;
}
/** characters arrive out of a blur */
export function blurChars(el, t, { stagger = 0.018, d = 0.8, y = 18 } = {}) {
  const st = new SplitText(el, { type: "chars,words" });
  gsap.set(el, { autoAlpha: 0 });
  tl.set(el, { autoAlpha: 1 }, t);
  tl.fromTo(st.chars, { autoAlpha: 0, y, filter: "blur(12px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: d, ease: "power3.out", stagger }, t);
  return st;
}
/** whole element: rise and fade */
export function rise(sel, t, d = 0.8, dy = 40, stagger = 0, ease = "expo.out") {
  tl.fromTo(sel, { autoAlpha: 0, y: dy }, { autoAlpha: 1, y: 0, duration: d, ease, stagger }, t);
}
export function pop(sel, t, from = {}, d = 0.7, ease = "back.out(1.7)") {
  tl.fromTo(sel, { autoAlpha: 0, y: 30, scale: 0.92, ...from }, { autoAlpha: 1, x: 0, y: 0, scale: 1, rotation: 0, rotationX: 0, rotationY: 0, duration: d, ease }, t);
}
export function typeText(el, text, t, dur, { caret = null, human = false, sound = true, hold = 0.3 } = {}) {
  el = typeof el === "string" ? $(el) : el;
  const o = { n: 0 };
  el.textContent = "";
  tl.to(o, { n: text.length, duration: dur, ease: "none", onUpdate() { el.textContent = text.slice(0, Math.round(o.n)); } }, t);
  if (caret) { tl.set(caret, { autoAlpha: 1 }, t); tl.set(caret, { autoAlpha: 0 }, t + dur + hold); }
  if (sound) cue(human ? "typeH" : "typeA", t, { d: dur, n: text.length });
}
export function scramble(el, to, t, dur, chars = "!<>-_\\/[]{}—=+*^?#ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") {
  tl.to(el, { duration: dur, scrambleText: { text: to, chars, revealDelay: dur * 0.35, speed: 0.6 }, ease: "none" }, t);
  cue("glitch", t, { d: dur * 0.7 });
}
export function counter(el, from, to, t, dur, dec = 1) {
  el = typeof el === "string" ? $(el) : el;
  const o = { v: from };
  tl.to(o, { v: to, duration: dur, ease: "power2.out", onUpdate() { el.textContent = o.v.toFixed(dec); } }, t);
}
/** DOM camera on a .cam layer: world point (px,py) shown at screen (qx,qy) with scale s */
export function cam2d(sel, t, d, s, px, py, qx = px, qy = py, ease = "power3.inOut") {
  tl.to(sel, { scale: s, x: qx - s * px, y: qy - s * py, duration: d, ease }, t);
}
export function cam2dSet(sel, t, s, px, py, qx = px, qy = py) { tl.set(sel, { scale: s, x: qx - s * px, y: qy - s * py }, t); }
export function blink(el, t) { tl.to(el.querySelectorAll(".eye"), { scaleY: 0.08, duration: 0.07, yoyo: true, repeat: 1, ease: "power1.in", transformOrigin: "50% 50%" }, t); }

/** tween a {r,g,b} state colour to a hex */
import { rgbOf } from "./world.js";
export function colorTo(obj, hex, t, d = 1, ease = "power1.inOut") { const c = rgbOf(hex); tl.to(obj, { r: c.r, g: c.g, b: c.b, duration: d, ease }, t); }
