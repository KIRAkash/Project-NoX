"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "@/lib/motion";
import { APPS, MESH, SHELLS, type AppNode } from "@/lib/content";
import { bodyWorld } from "@/lib/orbit-math";

/*
 * The hero diagram is a small 3D scene, not a drawing of one. Each application
 * is placed in world space from its orbital elements every frame, run through a
 * perspective camera, and drawn back to front. That is what buys depth scaling,
 * occlusion behind the star, and a camera the visitor can actually drag, zoom
 * and select into.
 */

const VB = 800; // square viewBox; all world units live in this space
const CX = VB / 2;
const CY = VB / 2;
const CAM_DIST = 1150; // larger = weaker perspective
const STAR_R = 51;
const TAU = Math.PI * 2;
const LABEL_PAD = 24; // labels never render closer than this to the viewBox edge

const PITCH_MIN = 0.14; // near edge-on
const PITCH_MAX = 1.26; // near top-down
const PITCH_DEFAULT = 0.46;

const ZOOM_MIN = 0.72;
const ZOOM_MAX = 1.6;

const RING_SAMPLES = 96;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Shade = { lit: string; mid: string; dark: string; glow: string; label: string };

/**
 * Each application has its own identity colour (`AppNode.hue`) rather than a
 * colour shared by its tier — the "constellation" set from the design canvas.
 * These are the shaded variants a sphere needs: a near-white highlight, the
 * hue itself, a terminator shadow, a translucent halo, and a muted label tint
 * for when it is not the focus. Derived once from each hue so the five stay
 * in step if a hue ever changes.
 */
function hexToHsl(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number) {
  s = clamp(s, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  const i = Math.floor(h * 6);
  if (i === 0) [r, g, b] = [c, x, 0];
  else if (i === 1) [r, g, b] = [x, c, 0];
  else if (i === 2) [r, g, b] = [0, c, x];
  else if (i === 3) [r, g, b] = [0, x, c];
  else if (i === 4) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return (
    "#" +
    [to255(r), to255(g), to255(b)]
      .map((v) => clamp(v, 0, 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function shadesOf(hex: string): Shade {
  const { h, s, l } = hexToHsl(hex);
  const n = parseInt(hex.slice(1), 16);
  const glow = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},.28)`;
  return {
    mid: hex,
    lit: hslToHex(h, s * 1.2, 0.92),
    dark: hslToHex(h, s * 0.85, 0.24),
    label: hslToHex(h, s * 0.55, 0.84),
    glow,
  };
}

const SHADES: Record<string, Shade> = Object.fromEntries(APPS.map((a) => [a.id, shadesOf(a.hue)]));

type Projected = { x: number; y: number; z: number; s: number };

function project(wx: number, wy: number, wz: number, yaw: number, pitch: number): Projected {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = wx * cy + wz * sy;
  const z1 = -wx * sy + wz * cy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = wy * cp - z1 * sp;
  const z2 = wy * sp + z1 * cp;

  const s = CAM_DIST / (CAM_DIST + z2);
  return { x: CX + x1 * s, y: CY + y2 * s, z: z2, s };
}

/**
 * Sample an orbit and split it where it crosses the star plane, so the far half
 * draws behind the star and the near half in front of it.
 */
function ringPaths(a: number, incl: number, yaw: number, pitch: number) {
  const pts: Projected[] = [];
  const ci = Math.cos(incl);
  const si = Math.sin(incl);
  for (let i = 0; i < RING_SAMPLES; i++) {
    const th = (TAU * i) / RING_SAMPLES;
    const pz = a * Math.sin(th);
    pts.push(project(a * Math.cos(th), -pz * si, pz * ci, yaw, pitch));
  }

  const runs: { far: boolean; d: string }[] = [];
  let current: string[] = [];
  let currentFar = pts[0].z >= 0;
  for (let i = 0; i <= RING_SAMPLES; i++) {
    const p = pts[i % RING_SAMPLES];
    const far = p.z >= 0;
    if (far !== currentFar && current.length) {
      runs.push({ far: currentFar, d: `M${current.join("L")}` });
      current = [];
      currentFar = far;
    }
    current.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  }
  if (current.length > 1) runs.push({ far: currentFar, d: `M${current.join("L")}` });

  const join = (far: boolean) =>
    runs
      .filter((r) => r.far === far)
      .map((r) => r.d)
      .join(" ") || "M0 0";

  return { far: join(true), near: join(false) };
}

/** Closed outline of the orbital plane, used for the faint ecliptic disc. */
function discPath(a: number, yaw: number, pitch: number) {
  const parts: string[] = [];
  for (let i = 0; i < RING_SAMPLES; i++) {
    const th = (TAU * i) / RING_SAMPLES;
    const p = project(a * Math.cos(th), 0, a * Math.sin(th), yaw, pitch);
    parts.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  }
  return `M${parts.join("L")}Z`;
}

/** A contract link, bowed away from the star so it does not cut the centre. */
function linkControl(pa: Projected, pb: Projected) {
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  let ox = mx - CX;
  let oy = my - CY;
  const len = Math.hypot(ox, oy) || 1;
  const bow = Math.min(Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.16, 70);
  ox = (ox / len) * bow;
  oy = (oy / len) * bow;
  return { cx: mx + ox, cy: my + oy };
}

function quadAt(pa: Projected, c: { cx: number; cy: number }, pb: Projected, t: number) {
  const u = 1 - t;
  return {
    x: u * u * pa.x + 2 * u * t * c.cx + t * t * pb.x,
    y: u * u * pa.y + 2 * u * t * c.cy + t * t * pb.y,
  };
}

function shortestAngle(from: number, to: number) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export default function OrbitalSystem() {
  const wrap = useRef<HTMLDivElement>(null);
  const zoomWrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);

  // Per-frame state lives in refs so the render loop never triggers React.
  const cam = useRef({ yaw: -1.2, pitch: PITCH_MAX, vYaw: 0, vPitch: 0 });
  const pointer = useRef({ px: 0, py: 0, active: false });
  const drag = useRef({ on: false, x: 0, y: 0, moved: 0, wasDrag: false });
  const intro = useRef(true);
  const introTl = useRef<gsap.core.Timeline | null>(null);
  const selRef = useRef<string | null>(null);
  // The mouse hover target is recomputed every frame from the pointer's
  // live position against each body's live projected position — never set
  // from pointerenter/pointerleave. Those only fire on cursor movement, but
  // the planets keep orbiting under a stationary cursor (and are reordered
  // in the DOM every frame for depth sorting), so a hover set that way can
  // drift out from under the mouse and never receive the leave event that
  // would clear it. Recomputing it fresh each frame is self-correcting.
  const hovRef = useRef<string | null>(null);
  const kbFocusRef = useRef<string | null>(null);
  // The unzoomed CSS-px-per-world-unit ratio (from ResizeObserver, cheap) times
  // the live zoom factor — composed instead of read from the DOM every frame,
  // which would force a synchronous layout on every tick.
  const baseScaleRef = useRef(1);
  const zoomRef = useRef({ current: 1, target: 1 });

  const setSelection = useCallback((id: string | null) => {
    selRef.current = id;
    setSelected(id);
    if (id) setTouched(true);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T;
    const qOpt = <T extends Element>(sel: string) => svg.querySelector(sel) as T | null;
    const qq = <T extends Element>(sel: string) => Array.from(svg.querySelectorAll(sel)) as T[];

    const bodiesLayer = q<SVGGElement>("[data-bodies-layer]");
    const disc = q<SVGPathElement>("[data-disc]");
    const ringFar = qq<SVGPathElement>("[data-ring-far]");
    const ringNear = qq<SVGPathElement>("[data-ring-near]");
    const linkEls = qq<SVGPathElement>("[data-link]");
    const packetEls = qq<SVGCircleElement>("[data-packet]");

    const bodies = APPS.map((app) => ({
      app,
      g: q<SVGGElement>(`[data-body="${app.id}"]`),
      halo: q<SVGCircleElement>(`[data-halo="${app.id}"]`),
      sphere: q<SVGCircleElement>(`[data-sphere="${app.id}"]`),
      spec: q<SVGEllipseElement>(`[data-spec="${app.id}"]`),
      planetRing: qOpt<SVGEllipseElement>(`[data-planetring="${app.id}"]`),
      ring: q<SVGCircleElement>(`[data-selring="${app.id}"]`),
      hit: q<SVGCircleElement>(`[data-hit="${app.id}"]`),
      label: q<SVGTextElement>(`[data-label="${app.id}"]`),
      grad: q<SVGRadialGradientElement>(`#grad-${app.id}`),
      p: { x: CX, y: CY, z: 0, s: 1 } as Projected,
    }));
    const byId = new Map(bodies.map((b) => [b.app.id, b]));

    const measure = () => {
      baseScaleRef.current = svg.getBoundingClientRect().width / VB / zoomRef.current.current;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);

    const reduced = prefersReducedMotion();
    let t = reduced ? 6 : 0;
    let last = performance.now();

    const frame = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!reduced) t += dt;

      // Smoothly ease toward the wheel/pinch zoom target and apply it as a CSS
      // scale on the wrapper, entirely outside the coordinate math below — the
      // projection, occlusion and mesh geometry never need to know the zoom.
      const z = zoomRef.current;
      z.current += (z.target - z.current) * Math.min(1, dt * 9);
      if (zoomWrapRef.current) zoomWrapRef.current.style.transform = `scale(${z.current.toFixed(4)})`;

      const c = cam.current;

      if (!drag.current.on) {
        if (selRef.current) {
          // Hold the selected application at the front of the system while the
          // rest of the estate keeps turning around it.
          const b = byId.get(selRef.current);
          if (b) {
            const { theta } = bodyWorld(b.app.orbit, t);
            c.yaw += shortestAngle(c.yaw, theta + Math.PI / 2) * Math.min(1, dt * 3.2);
          }
        } else {
          // Inertia from the last drag, then a slow idle drift.
          c.yaw += c.vYaw;
          c.pitch = clamp(c.pitch + c.vPitch, PITCH_MIN, PITCH_MAX);
          c.vYaw *= 0.94;
          c.vPitch *= 0.9;
          if (Math.abs(c.vYaw) < 0.0004) c.vYaw = 0;
          if (!reduced && !intro.current) c.yaw += dt * 0.022;
        }
      }

      // Pointer parallax: a small lean toward the cursor, never a full turn.
      const idle = pointer.current.active && !drag.current.on;
      const yaw = c.yaw + (idle ? pointer.current.px * 0.1 : 0);
      const pitch = clamp(c.pitch + (idle ? pointer.current.py * 0.06 : 0), PITCH_MIN, PITCH_MAX);

      // --- orbital scaffolding ---------------------------------------------
      disc.setAttribute("d", discPath(SHELLS[SHELLS.length - 1].a + 18, yaw, pitch));
      SHELLS.forEach((shell, i) => {
        const { far, near } = ringPaths(shell.a, shell.incl, yaw, pitch);
        ringFar[i].setAttribute("d", far);
        ringNear[i].setAttribute("d", near);
      });

      // --- bodies: project, then paint back-to-front ------------------------
      for (const b of bodies) {
        const w = bodyWorld(b.app.orbit, t);
        b.p = project(w.wx, w.wy, w.wz, yaw, pitch);
      }
      // A body further from the camera (larger z) must be painted first, so a
      // nearer one always occludes it correctly — SVG has no z-index, only DOM
      // order, so the group is physically reordered each frame. Cheap at eight
      // elements, and it is the difference between a real 3D scene and eight
      // circles that merely change size. Moving a focused element in the DOM
      // silently blurs it in most engines (confirmed: focus survives a
      // microtask but is gone after exactly one animation frame), which would
      // make keyboard navigation of the diagram unusable — so restore focus
      // immediately if this reorder stole it.
      const focusedBefore = document.activeElement;
      for (const b of [...bodies].sort((x, y) => y.p.z - x.p.z)) bodiesLayer.appendChild(b.g);
      if (
        focusedBefore &&
        focusedBefore !== document.activeElement &&
        svg.contains(focusedBefore) &&
        typeof (focusedBefore as HTMLElement).focus === "function"
      ) {
        (focusedBefore as HTMLElement).focus({ preventScroll: true });
      }

      // Recompute which body the pointer is over, from its live position — see
      // the note on hovRef above for why this can't be event-driven here.
      if (pointer.current.active && !drag.current.on) {
        const psx = (pointer.current.px + 1) * (VB / 2);
        const psy = (pointer.current.py + 1) * (VB / 2);
        let nearest: string | null = null;
        let nearestDist = Infinity;
        for (const b of bodies) {
          const hitR = Math.max(24, b.app.orbit.size * b.p.s + 16);
          const d = Math.hypot(psx - b.p.x, psy - b.p.y);
          if (d <= hitR && d < nearestDist) {
            nearestDist = d;
            nearest = b.app.id;
          }
        }
        hovRef.current = nearest;
      } else {
        hovRef.current = null;
      }

      const sel = selRef.current;
      const focus = sel ?? hovRef.current ?? kbFocusRef.current;
      const neighbours = focus
        ? new Set(MESH.filter(([a, z2]) => a === focus || z2 === focus).flat())
        : null;

      for (const b of bodies) {
        const { p } = b;
        const shade = SHADES[b.app.id];
        const r = b.app.orbit.size * p.s;

        // Fade into the corona when passing behind the star.
        const dist = Math.hypot(p.x - CX, p.y - CY);
        const occl = p.z > 0 ? clamp((dist - STAR_R * 0.9) / (STAR_R * 1.5), 0, 1) : 1;

        const related = !focus || b.app.id === focus || neighbours!.has(b.app.id);
        const alpha = occl * (related ? 1 : 0.22);
        const isFocus = b.app.id === focus;

        b.sphere.setAttribute("cx", p.x.toFixed(2));
        b.sphere.setAttribute("cy", p.y.toFixed(2));
        b.sphere.setAttribute("r", r.toFixed(2));
        b.sphere.setAttribute("opacity", alpha.toFixed(3));

        // The lit limb, the gradient's hot focal point, and the specular glint
        // all lean the same way — toward the star.
        const dx = CX - p.x;
        const dy = CY - p.y;
        const dl = Math.hypot(dx, dy) || 1;
        const ux = dx / dl;
        const uy = dy / dl;
        b.grad.setAttribute("fx", (0.5 + ux * 0.34).toFixed(3));
        b.grad.setAttribute("fy", (0.5 + uy * 0.34).toFixed(3));

        b.spec.setAttribute("cx", (p.x + ux * r * 0.3).toFixed(2));
        b.spec.setAttribute("cy", (p.y + uy * r * 0.3).toFixed(2));
        b.spec.setAttribute("rx", (r * 0.26).toFixed(2));
        b.spec.setAttribute("ry", (r * 0.18).toFixed(2));
        b.spec.setAttribute("opacity", (alpha * 0.55).toFixed(3));

        if (b.planetRing) {
          b.planetRing.setAttribute("cx", p.x.toFixed(2));
          b.planetRing.setAttribute("cy", p.y.toFixed(2));
          b.planetRing.setAttribute("rx", (r * 2.05).toFixed(2));
          b.planetRing.setAttribute("ry", (r * 0.72).toFixed(2));
          b.planetRing.setAttribute("transform", `rotate(-24 ${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
          b.planetRing.setAttribute("opacity", (alpha * (isFocus ? 0.85 : 0.55)).toFixed(3));
        }

        b.halo.setAttribute("cx", p.x.toFixed(2));
        b.halo.setAttribute("cy", p.y.toFixed(2));
        b.halo.setAttribute("r", (r * (isFocus ? 3.4 : 2.3)).toFixed(2));
        b.halo.setAttribute("opacity", (alpha * (isFocus ? 0.9 : 0.42)).toFixed(3));

        b.ring.setAttribute("cx", p.x.toFixed(2));
        b.ring.setAttribute("cy", p.y.toFixed(2));
        b.ring.setAttribute("r", (r + 9).toFixed(2));
        b.ring.setAttribute("opacity", b.app.id === sel ? alpha.toFixed(3) : "0");

        b.hit.setAttribute("cx", p.x.toFixed(2));
        b.hit.setAttribute("cy", p.y.toFixed(2));
        b.hit.setAttribute("r", Math.max(24, r + 16).toFixed(2));

        // The label always renders fully inside the viewBox: it is offset
        // outward from the body as usual, but clamped to a safe interior
        // margin, and its anchor flips so the text grows back inward from
        // whichever edge it was clamped against — it can never run off the
        // diagram, however far a body swings toward the rim.
        const rawLeft = p.x < CX;
        let lx = p.x + (rawLeft ? -(r + 11) : r + 11);
        let anchor: "start" | "end" = rawLeft ? "end" : "start";
        if (lx < LABEL_PAD) {
          lx = LABEL_PAD;
          anchor = "start";
        } else if (lx > VB - LABEL_PAD) {
          lx = VB - LABEL_PAD;
          anchor = "end";
        }
        b.label.setAttribute("x", lx.toFixed(2));
        b.label.setAttribute("y", (p.y + 4).toFixed(2));
        b.label.setAttribute("text-anchor", anchor);
        b.label.setAttribute("font-size", (11 * Math.max(0.82, p.s)).toFixed(2));
        b.label.setAttribute("fill", isFocus ? "#ECEFF8" : shade.label);
        const nearBoost = clamp(0.34 + (p.s - 0.79) * 0.6, 0, 1);
        b.label.setAttribute("opacity", (alpha * (isFocus ? 1 : nearBoost)).toFixed(3));
      }

      // --- contract links and their traffic ----------------------------------
      MESH.forEach(([aId, bId], i) => {
        const a = byId.get(aId)!;
        const z2 = byId.get(bId)!;
        const ctrl = linkControl(a.p, z2.p);
        const lit = focus === aId || focus === bId;

        const el = linkEls[i];
        el.setAttribute(
          "d",
          `M${a.p.x.toFixed(1)} ${a.p.y.toFixed(1)}Q${ctrl.cx.toFixed(1)} ${ctrl.cy.toFixed(1)} ${z2.p.x.toFixed(1)} ${z2.p.y.toFixed(1)}`,
        );
        el.setAttribute("stroke", lit ? "rgba(247,181,66,.85)" : "rgba(134,185,238,.13)");
        el.setAttribute("opacity", focus && !lit ? "0.1" : "1");

        // One packet of traffic per contract, with a gap between runs.
        const packet = packetEls[i];
        const travel = (((t * 0.55 + i * 0.47) % 3.4) / 3.4) * 1.9;
        if (travel <= 1 && !reduced) {
          const pt = quadAt(a.p, ctrl, z2.p, travel);
          packet.setAttribute("cx", pt.x.toFixed(1));
          packet.setAttribute("cy", pt.y.toFixed(1));
          packet.setAttribute("r", lit ? "3.6" : "2.1");
          packet.setAttribute("fill", lit ? "#FFE2A6" : "#C9E1FB");
          packet.setAttribute("opacity", (clamp(Math.min(travel, 1 - travel) * 6, 0, 1) * (lit ? 1 : 0.6)).toFixed(2));
        } else {
          packet.setAttribute("opacity", "0");
        }
      });

      // --- telemetry card for the selected application ------------------------
      const card = cardRef.current;
      if (card && sel) {
        const b = byId.get(sel)!;
        const k = baseScaleRef.current * zoomRef.current.current;
        const flip = b.p.x > CX;
        card.style.transform =
          `translate(${(b.p.x * k).toFixed(1)}px, ${(b.p.y * k).toFixed(1)}px) ` +
          `translate(${flip ? "-100%" : "0%"}, -50%) translate(${flip ? -18 : 18}px, 0)`;
      }
    };

    gsap.ticker.add(frame);
    frame();
    return () => {
      gsap.ticker.remove(frame);
      ro.disconnect();
    };
  }, []);

  /*
   * Opening move: the system arrives face-on, where it reads as a flat chart,
   * then tilts back and swings round to its resting pose. The third dimension
   * announces itself before anyone thinks to reach for the diagram.
   */
  useEffect(() => {
    if (prefersReducedMotion()) {
      cam.current.yaw = -0.35;
      cam.current.pitch = PITCH_DEFAULT;
      intro.current = false;
      return;
    }
    const tl = gsap.timeline({ onComplete: () => void (intro.current = false) });
    tl.fromTo(cam.current, { pitch: PITCH_MAX }, { pitch: PITCH_DEFAULT, duration: 2.6, ease: "power2.inOut" }, 0.45)
      .fromTo(cam.current, { yaw: -1.2 }, { yaw: -0.35, duration: 3.1, ease: "power2.out" }, 0.45);
    introTl.current = tl;
    return () => {
      tl.kill();
    };
  }, []);

  // Ambient: the corona breathes, and the whole system recedes on scroll.
  useEffect(() => {
    if (prefersReducedMotion() || !wrap.current) return;
    const corona = gsap.to(wrap.current.querySelectorAll(".nox-corona"), {
      scale: 1.1,
      opacity: 0.95,
      transformOrigin: "center",
      duration: 5.5,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
    const tw = gsap.to(wrap.current, {
      y: -90,
      scale: 0.94,
      opacity: 0.45,
      ease: "none",
      scrollTrigger: { trigger: wrap.current, start: "top top", end: "bottom top", scrub: 0.6 },
    });
    return () => {
      corona.kill();
      tw.scrollTrigger?.kill();
      tw.kill();
    };
  }, []);

  // Ctrl/Cmd+wheel or a trackpad pinch zooms the diagram; a plain wheel still
  // scrolls the page normally — the diagram never traps ordinary scrolling.
  // React's synthetic wheel handler is passive by default, so this needs a
  // real listener to call preventDefault when it actually claims the gesture.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = zoomRef.current;
      z.target = clamp(z.target - e.deltaY * 0.0016, ZOOM_MIN, ZOOM_MAX);
      setTouched(true);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    introTl.current?.kill();
    intro.current = false;
    drag.current = { on: true, x: e.clientX, y: e.clientY, moved: 0, wasDrag: false };
    cam.current.vYaw = 0;
    cam.current.vPitch = 0;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointer.current.px = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.current.py = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    pointer.current.active = true;

    if (!drag.current.on) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current.x = e.clientX;
    drag.current.y = e.clientY;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);

    const yawStep = -dx * 0.006;
    const pitchStep = dy * 0.005;
    cam.current.yaw += yawStep;
    cam.current.pitch = clamp(cam.current.pitch + pitchStep, PITCH_MIN, PITCH_MAX);
    cam.current.vYaw = yawStep;
    cam.current.vPitch = pitchStep;

    if (drag.current.moved > 6) {
      if (selRef.current) setSelection(null);
      setTouched(true);
    }
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current.on) return;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* the pointer was never captured */
    }
    // Latch whether this gesture was a drag, then clear the distance — a click
    // arrives after pointerup, and must not be judged by the previous gesture.
    drag.current.wasDrag = drag.current.moved > 6;
    drag.current.moved = 0;
    drag.current.on = false;
    setDragging(false);
  };

  const pick = (id: string) => {
    if (drag.current.wasDrag) return; // that gesture was a drag, not a click
    setSelection(selRef.current === id ? null : id);
  };

  const selectedApp = APPS.find((a) => a.id === selected) ?? null;

  return (
    <div ref={wrap} className="relative w-full select-none">
      <div ref={zoomWrapRef} style={{ transformOrigin: "center" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB} ${VB}`}
          className={`block w-full touch-none overflow-visible ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          role="img"
          aria-label="Interactive diagram: enterprise applications orbiting NoX, joined by the contracts they hold. Drag to turn the system, scroll with a modifier key or pinch to zoom, and select an application to bring it to the front."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(e) => {
            pointer.current.active = false;
            endDrag(e);
          }}
        >
          <defs>
            <radialGradient id="noxCore" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFF6DE" />
              <stop offset="38%" stopColor="#F7B542" />
              <stop offset="100%" stopColor="#E9713C" />
            </radialGradient>
            <radialGradient id="noxGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(247,181,66,.45)" />
              <stop offset="45%" stopColor="rgba(233,113,60,.13)" />
              <stop offset="100%" stopColor="rgba(233,113,60,0)" />
            </radialGradient>
            <radialGradient id="eclipticFill" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(134,185,238,.05)" />
              <stop offset="70%" stopColor="rgba(134,185,238,.015)" />
              <stop offset="100%" stopColor="rgba(134,185,238,0)" />
            </radialGradient>
            {APPS.map((app) => {
              const shade = SHADES[app.id];
              return (
                <radialGradient key={app.id} id={`grad-${app.id}`} cx="0.5" cy="0.5" r="0.62" fx="0.5" fy="0.5">
                  <stop offset="0%" stopColor={shade.lit} />
                  <stop offset="42%" stopColor={shade.mid} />
                  <stop offset="100%" stopColor={shade.dark} />
                </radialGradient>
              );
            })}
          </defs>

          {/* the orbital plane */}
          <path data-disc fill="url(#eclipticFill)" stroke="none" />

          {/* far halves of the orbits */}
          {SHELLS.map((_, i) => (
            <path
              key={`far-${i}`}
              data-ring-far
              fill="none"
              stroke={i === 0 ? "rgba(247,181,66,.42)" : "rgba(160,178,220,.36)"}
              strokeWidth="1.1"
              strokeDasharray="4 7"
            />
          ))}

          {/* contract mesh */}
          {MESH.map(([a, b]) => (
            <path key={`${a}-${b}`} data-link fill="none" strokeWidth="0.9" strokeDasharray="3 8" />
          ))}

          {/* the star */}
          <circle className="nox-corona" cx={CX} cy={CY} r={333} fill="url(#noxGlow)" />
          <circle cx={CX} cy={CY} r={STAR_R} fill="url(#noxCore)" />
          <circle cx={CX} cy={CY} r={STAR_R} fill="none" stroke="rgba(255,246,222,.55)" strokeWidth="1" />

          {/* near halves of the orbits */}
          {SHELLS.map((_, i) => (
            <path
              key={`near-${i}`}
              data-ring-near
              fill="none"
              stroke={i === 0 ? "rgba(250,196,96,.68)" : "rgba(178,196,236,.56)"}
              strokeWidth="1.5"
            />
          ))}

          {/* applications — reordered every frame so the nearer body always wins */}
          <g data-bodies-layer>
            {APPS.map((app) => (
              <g
                key={app.id}
                data-body={app.id}
                tabIndex={0}
                role="button"
                aria-label={`${app.name}, ${app.kind}`}
                aria-pressed={selected === app.id}
                className="cursor-pointer outline-none"
                onFocus={() => (kbFocusRef.current = app.id)}
                onBlur={() => (kbFocusRef.current = null)}
                onClick={() => pick(app.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelection(selRef.current === app.id ? null : app.id);
                  }
                }}
              >
                {app.tier === "core" && (
                  <ellipse
                    data-planetring={app.id}
                    fill="none"
                    stroke={SHADES[app.id].mid}
                    strokeWidth="1"
                    opacity="0"
                  />
                )}
                <circle data-halo={app.id} fill={SHADES[app.id].glow} />
                <circle data-sphere={app.id} fill={`url(#grad-${app.id})`} />
                <ellipse data-spec={app.id} fill="#FFFFFF" opacity="0" />
                <circle data-selring={app.id} fill="none" stroke="#F7B542" strokeWidth="1" strokeDasharray="2 4" />
                <circle data-hit={app.id} fill="transparent" />
              </g>
            ))}
          </g>

          {/* contract traffic */}
          {MESH.map(([a, b]) => (
            <circle key={`p-${a}-${b}`} data-packet opacity="0" />
          ))}

          {/* labels ride above everything, always inside the safe margin */}
          {APPS.map((app) => (
            <text
              key={`l-${app.id}`}
              data-label={app.id}
              className="pointer-events-none font-mono"
              letterSpacing=".04em"
              style={{ paintOrder: "stroke", stroke: "rgba(5,6,11,.82)", strokeWidth: 3, strokeLinejoin: "round" }}
            >
              {app.name}
            </text>
          ))}
        </svg>
      </div>

      {/* telemetry card for the selected application */}
      <div
        ref={cardRef}
        aria-live="polite"
        className={`pointer-events-none absolute left-0 top-0 z-10 w-[236px] rounded-sm border border-[rgba(247,181,66,.35)] bg-[rgba(7,8,15,.92)] p-3.5 backdrop-blur-sm transition-opacity duration-300 ${
          selectedApp ? "opacity-100" : "opacity-0"
        }`}
      >
        {selectedApp && (
          <>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="flex-1 text-[13.5px] font-semibold tracking-[-0.005em] text-ink">
                {selectedApp.name}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-nox">
                {selectedApp.kind}
              </span>
            </div>
            <div className="mb-2.5 flex flex-col gap-1">
              {selectedApp.contracts.map((c) => (
                <div key={c.left} className="font-mono text-[10px] leading-[1.45] text-ink-faint">
                  <span className="text-ice">{c.left}</span> &rarr; {c.right}
                </div>
              ))}
            </div>
            <div className="border-t border-hairline pt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-dim">
              {selectedApp.freshness}
            </div>
          </>
        )}
      </div>

      {/* constellation legend — always-visible, so the diagram's interactivity
          never depends on a visitor discovering it by accident */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 hidden w-[168px] flex-col gap-[3px] rounded-sm border border-hairline bg-[rgba(7,8,15,.72)] p-2.5 backdrop-blur-sm sm:flex">
        <div className="mb-1 px-1 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-dim">
          Estate
        </div>
        {APPS.map((app) => {
          const on = app.id === selected;
          return (
            <button
              key={app.id}
              type="button"
              onClick={() => setSelection(selected === app.id ? null : app.id)}
              className={`pointer-events-auto flex items-center gap-2 rounded-sm px-1.5 py-[5px] text-left transition-colors duration-150 ${
                on ? "bg-[rgba(247,181,66,.1)]" : "hover:bg-[rgba(134,185,238,.06)]"
              }`}
            >
              <span
                className="block h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: SHADES[app.id].mid }}
              />
              <span
                className={`truncate font-mono text-[10.5px] tracking-[0.01em] ${on ? "text-ink" : "text-ink-muted"}`}
              >
                {app.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* one-time affordance */}
      <div
        className={`pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim transition-opacity duration-500 ${
          touched ? "opacity-0" : "opacity-100"
        }`}
      >
        Drag to turn &middot; ctrl+scroll to zoom &middot; select an application
      </div>
    </div>
  );
}
