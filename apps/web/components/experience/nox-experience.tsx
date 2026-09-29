"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { gsap, ScrollTrigger, prefersReducedMotion } from "@/lib/motion";
import { APPS } from "@/lib/content";
import { Accent, Check } from "@/components/landing/primitives";
import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";
import SpecBook, { BOOK_SPAN, type SpecBookHandle } from "@/components/sections/spec-book/spec-book";
import ExperienceScene, {
  SUN_R,
  CAM_REST_Z,
  type SceneHandle,
  type RotationDrive,
  type LayoutDrive,
  type SystemOffset,
} from "./experience-scene";

/*
 * The whole front door in one component: a pure graphic reveal (extreme
 * close on the star's corona, a camera dolly out as the estate resolves,
 * the "Project S☉L" wordmark assembling once it settles) that a visitor
 * then advances past — Enter or a click — into a two-up layout: the same
 * galaxy, now leaning toward the right (or, on narrow screens, the bottom)
 * and left spinning freely under the visitor's own drag, beside the opening
 * pitch. The canvas is always full-bleed, in both phases — "docking" is
 * done by moving the star system itself in world space (see `SystemOffset`
 * in experience-scene.tsx), never by resizing or cropping the canvas — so
 * the particle field and starfield keep spanning the whole screen, visible
 * around and behind the text panel, instead of stopping at a hard edge.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Phase = "reveal" | "arrived";

/** Where the star system leans once arrived, in world units — enough to
 *  clear the text panel on each layout without ever touching the canvas's
 *  own size. Desktop leans right; narrow screens (where the text sits above
 *  a lower galaxy band instead) lean down. */
function restOffset(): SystemOffset {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return window.innerWidth >= 1024 ? { x: 190, y: 6 } : { x: 0, y: -112 };
}

// The resting tilt once arrived — the estate pitches forward/down by a full
// 45° on top of the reveal's own pose as part of the docking transition
// itself, so the tilt reads as a deliberate move the visitor watches happen,
// not just a static end pose.
const REST_PITCH = Math.PI / 4;
const REST_YAW = 0.3;

export default function NoxExperience() {
  const rootRef = useRef<HTMLElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const nLetterRef = useRef<HTMLSpanElement>(null);
  const xLetterRef = useRef<HTMLSpanElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const sourcesPanelRef = useRef<HTMLDivElement>(null);
  const bookWrapRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<SpecBookHandle>(null);
  // where the spec book's own timeline starts inside the pinned scrub, for its step links
  const bookAtRef = useRef(0);
  const launchPanelRef = useRef<HTMLDivElement>(null);
  const cornerWordmarkRef = useRef<HTMLDivElement>(null);
  const dragHintRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  const startedRef = useRef(false);
  const arrivedRef = useRef(false);
  const introTlRef = useRef<gsap.core.Timeline | null>(null);
  const mapTlRef = useRef<gsap.core.Timeline | null>(null);

  const rotRef = useRef<RotationDrive>({ yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, dragging: false });
  const layoutRef = useRef<LayoutDrive>({ orbit: 1, planet: 1 });
  const offsetRef = useRef<SystemOffset>({ x: 0, y: 0 });
  // 1 = full size, scrubbed down to ~0 as the visitor scrolls through the
  // hand-off to the spec beats — the whole estate shrinking away and
  // vanishing together, handing off to the spec book rather than just
  // scrolling out of frame.
  const scaleRef = useRef(1);
  // 0 → 1 as the visitor scrolls through the pinned "map" beat below —
  // scrubbed, so it reverses cleanly if they scroll back up — blended into
  // the contract lines' base opacity so they read as "these are the
  // connections" without anyone needing to hover.
  const mapRevealRef = useRef(0);
  // 0 → 1 through the "sources" beat: the camera flies in to one application
  // and its knowledge sources appear as moons feeding it (see experience-scene).
  const focusRef = useRef(0);
  const dragRef = useRef({ on: false, x: 0, y: 0 });

  const [phase, setPhase] = useState<Phase>("reveal");
  const [dragging, setDragging] = useState(false);
  const [labelsVisible, setLabelsVisible] = useState(false);

  const phaseRef = useRef<Phase>("reveal");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const showWordmark = (instant: boolean) => {
    const s = nLetterRef.current;
    const l = xLetterRef.current;
    const p = projectRef.current;
    if (!s || !l || !p) return;
    if (instant) {
      gsap.set([s, l, p], { opacity: 1, x: 0, y: 0 });
      return;
    }
    // Only x (the slide-in) and opacity are one-time here — y on N/X is
    // owned by the continuous sync below, so the two never fight over the
    // same transform.
    gsap
      .timeline()
      .fromTo(s, { opacity: 0, x: -36 }, { opacity: 1, x: 0, duration: 0.9, ease: "back.out(1.5)" }, 0)
      .fromTo(l, { opacity: 0, x: 36 }, { opacity: 1, x: 0, duration: 0.9, ease: "back.out(1.5)" }, 0)
      .fromTo(p, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.45);
  };

  const revealHint = () => {
    if (hintRef.current) gsap.to(hintRef.current, { opacity: 1, duration: 0.8, ease: "power2.out" });
  };

  /** Enter, or a click anywhere before arrival, both mean the same thing:
   *  move on. If the one-time dolly is still mid-flight this snaps it to
   *  its resting values first, rather than cutting away on a half-revealed
   *  frame — a click reads as "I've seen enough", not "abort". */
  const advance = () => {
    if (arrivedRef.current) return;
    arrivedRef.current = true;

    introTlRef.current?.progress(1);
    introTlRef.current?.kill();

    // overwrite: a still-running fade-in (Enter pressed just as the hint appeared) would otherwise finish after this and bring it back
    if (hintRef.current) gsap.to(hintRef.current, { opacity: 0, duration: 0.4, ease: "power1.out", overwrite: true });

    // Unlocked synchronously, right here — not left to the phase-keyed
    // effect below, which only runs a render later. setupMapScroll() (a few
    // lines down) measures the document to set up its pinned ScrollTrigger;
    // if that measurement happens while the body is still locked from the
    // "reveal" phase, the pinned range it records is wrong against the
    // document's real scrollable height, which is what made the transition
    // feel slow to reach and unable to scroll back out of.
    document.body.style.overflow = "";

    setPhase("arrived");
    window.setTimeout(() => setLabelsVisible(true), prefersReducedMotion() ? 0 : 900);

    const offsetTarget = restOffset();
    // Tighter orbits, bigger bodies, and a flatter, more open tilt — the
    // same estate reads clearly and looks deliberately composed once it's
    // leaning into its own side of the screen, instead of looking sparse
    // and centred the way the reveal's own pose does.
    if (prefersReducedMotion()) {
      Object.assign(layoutRef.current, { orbit: 0.72, planet: 1.4 });
      Object.assign(offsetRef.current, offsetTarget);
      Object.assign(rotRef.current, { pitch: REST_PITCH, yaw: REST_YAW });
    } else {
      gsap.to(layoutRef.current, { orbit: 0.72, planet: 1.4, duration: 1.3, ease: "power3.inOut" });
      gsap.to(offsetRef.current, { ...offsetTarget, duration: 1.3, ease: "power3.inOut" });
      gsap.to(rotRef.current, { pitch: REST_PITCH, yaw: REST_YAW, duration: 1.5, ease: "power3.inOut" });
    }

    setupMapScroll();

    const panel = textPanelRef.current;
    if (!panel) return;
    if (prefersReducedMotion()) {
      gsap.set(panel, { opacity: 1, x: 0 });
      return;
    }
    gsap.fromTo(panel, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 1.1, ease: "power3.out", delay: 0.35 });
  };

  /** Three beats, one pin, one continuous scrub:
   *   1. the pitch swaps for the map pitch, and the contract lines become
   *      visible without a hover;
   *   2. the estate itself hands off — it shrinks away to nothing while the
   *      pitch gives way to the spec book (the four seats writing their
   *      files with NoX, then locked, built and verified) where the galaxy
   *      was, and
   *      the wordmark stops tracking the (now-vanishing) sun and appears
   *      instead as a small fixed mark in the corner.
   *  All of it driven by scroll, but the *page* never actually scrolls while
   *  it happens: the hero pins in place for a few screens' worth of scroll
   *  distance, the transition scrubs against that distance, and only once
   *  it completes does the pin release and the hero scroll away like an
   *  ordinary section. */
  const setupMapScroll = () => {
    if (prefersReducedMotion()) return;
    const heroEl = rootRef.current;
    const pitchPanel = textPanelRef.current;
    const mapPanel = mapPanelRef.current;
    const sourcesPanel = sourcesPanelRef.current;
    if (!heroEl || !pitchPanel || !mapPanel) return;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: heroEl,
        start: "top top",
        end: "+=6370",
        pin: true,
        scrub: 0.3,
        anticipatePin: 1,
      },
    });
    // Explicit `fromTo`s, not `to`s that capture "current value" — this
    // timeline is built immediately after advance()'s own arrival tween
    // starts the pitch panel fading from opacity 0 to 1 (on a separate,
    // non-scrubbed tween, still mid-flight). A `.to()` here would have
    // captured that in-progress opacity (near 0) as its own start value,
    // making it a near no-op tween whose rendered value sits at 0 for any
    // scroll progress including 0 — the heading would fade out correctly
    // once by coincidence but then never come back on scrolling back up,
    // since a tween with the same start and end value has nothing to
    // reverse to. Literal values sidestep that race entirely, here and for
    // every other beat below.
    tl.fromTo(pitchPanel, { opacity: 1, y: 0 }, { opacity: 0, y: -18, duration: 0.3, ease: "power1.inOut" }, 0);
    tl.fromTo(mapPanel, { opacity: 0, y: 0 }, { opacity: 1, y: 0, duration: 0.3, ease: "power1.inOut" }, 0.25);
    tl.fromTo(mapRevealRef, { current: 0 }, { current: 1, duration: 0.5, ease: "power1.inOut" }, 0);

    // Beat 3 — one application, up close. The map's lines settle back while
    // the camera flies in to a single planet; its knowledge sources appear as
    // moons, one after another, and start feeding its one knowledge base.
    tl.fromTo(mapPanel, { opacity: 1, y: 0 }, { opacity: 0, y: -18, duration: 0.3, ease: "power1.inOut" }, 0.8);
    tl.fromTo(mapRevealRef, { current: 1 }, { current: 0, duration: 0.35, ease: "power1.inOut" }, 0.75);
    tl.fromTo(focusRef, { current: 0 }, { current: 1, duration: 0.7, ease: "power2.inOut" }, 0.75);
    if (wordmarkRef.current) {
      tl.fromTo(wordmarkRef.current, { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power1.inOut" }, 0.75);
    }
    if (dragHintRef.current) {
      tl.fromTo(dragHintRef.current, { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power1.inOut" }, 0.75);
    }
    if (sourcesPanel) {
      tl.fromTo(sourcesPanel, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.35, ease: "power1.inOut" }, 1.05);
      tl.fromTo(sourcesPanel, { opacity: 1, y: 0 }, { opacity: 0, y: -18, duration: 0.3, ease: "power1.inOut" }, 2.0);
    }

    // Beat 4 — the estate hands off to the specs. The camera pulls back out
    // as the whole estate shrinks away, and the spec deck takes its place:
    // the four seats writing their files with NoX, scrubbed seat by seat.
    const R = 1.2; // everything below moved later by the length of beat 3
    tl.fromTo(focusRef, { current: 1 }, { current: 0, duration: 0.6, ease: "power2.inOut" }, 2.0);
    // Exactly 0, not just very small — the sun's glow sprites are additive
    // and Bloom-picked, so even a near-zero footprint can still contribute
    // a faint bright dot; true zero-size renders nothing for it to bloom.
    tl.fromTo(scaleRef, { current: 1 }, { current: 0, duration: 0.65, ease: "power2.in" }, 0.78 + R);
    if (cornerWordmarkRef.current) {
      tl.fromTo(cornerWordmarkRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.inOut" }, 1.0 + R);
    }

    // in once the estate has shrunk nearly away, so its labels never show through the book
    const BOOK_IN = 1.35 + R;
    const BOOK_AT = BOOK_IN + 0.15;
    const BOOK_OUT = BOOK_AT + BOOK_SPAN + 0.15;
    const LAUNCH_AT = BOOK_OUT + 0.2;
    bookAtRef.current = BOOK_AT;

    // Beat 4 — the spec book: written page by page by the four seats, locked,
    // sent for development and returned verified. It sits over the screen
    // area the galaxy used, so pointer-events stay off until it's visible —
    // otherwise its buttons would steal the drag meant for the estate.
    // `.set()` calls in a scrubbed timeline toggle cleanly both ways.
    const bookWrap = bookWrapRef.current;
    const specBook = bookRef.current;
    if (bookWrap && specBook) {
      tl.set(bookWrap, { pointerEvents: "none" }, 0);
      tl.fromTo(bookWrap, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.35, ease: "power1.inOut" }, BOOK_IN);
      tl.set(bookWrap, { pointerEvents: "auto" }, BOOK_IN + 0.2);
      tl.add(specBook.build(), BOOK_AT);
      tl.fromTo(bookWrap, { opacity: 1, y: 0 }, { opacity: 0, y: -18, duration: 0.3, ease: "power1.inOut", immediateRender: false }, BOOK_OUT);
      tl.set(bookWrap, { pointerEvents: "none" }, BOOK_OUT);
    }

    // Beat 6 — the way in. One large Enter NoX, the last thing the pin
    // shows. `autoAlpha` keeps it hidden (and out of the tab order) until it
    // has actually arrived, and hides it again on the way back up.
    if (launchPanelRef.current) {
      tl.fromTo(launchPanelRef.current, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: "power1.inOut" }, LAUNCH_AT);
    }
    mapTlRef.current = tl;

    // The pin spacer this just inserted changes the document's total
    // height, and the body-overflow lock above was only just lifted — both
    // can leave ScrollTrigger's very first measurement stale. One refresh
    // once the layout has actually settled makes sure the pinned range is
    // measured against the real, final document.
    requestAnimationFrame(() => ScrollTrigger.refresh());
  };

  /** Scrolls the page to a point in the pinned scrub — the scrub maps scroll linearly onto its timeline. */
  const seekTo = (time: number) => {
    const tl = mapTlRef.current;
    const st = tl?.scrollTrigger;
    if (!tl || !st) return;
    window.scrollTo({ top: st.start + (st.end - st.start) * (time / tl.duration()), behavior: "smooth" });
  };

  const handleReady = (handle: SceneHandle) => {
    if (startedRef.current) return;
    startedRef.current = true;

    const { camera, planetRefs, settleRef } = handle;
    if (!camera) return;

    // Continuous, forever: the sun's true on-screen edges and centre, read
    // back each frame via real projection (never a hand-derived formula), so
    // the wordmark stays correct through the dolly, the docking transition,
    // the ambient camera's drift, and any window resize. `offsetRef` is
    // folded into the same world points the camera projects — the wordmark
    // never needs to know the canvas is full-bleed the whole time, only
    // where the star currently actually is.
    const edgeA = new THREE.Vector3();
    const edgeB = new THREE.Vector3();
    const origin = new THREE.Vector3();
    const syncWordmark = () => {
      const el = wordmarkRef.current;
      const s = nLetterRef.current;
      const l = xLetterRef.current;
      const p = projectRef.current;
      if (!el || !s || !l || !p) return;
      const rect = el.getBoundingClientRect();
      const ox = offsetRef.current.x;
      const oy = offsetRef.current.y;

      edgeA.set(ox - SUN_R, oy, 0).project(camera);
      edgeB.set(ox + SUN_R, oy, 0).project(camera);
      const xLeft = Math.min(edgeA.x, edgeB.x) * 0.5 * rect.width + rect.width / 2;
      const xRight = Math.max(edgeA.x, edgeB.x) * 0.5 * rect.width + rect.width / 2;
      const diameter = xRight - xLeft;
      el.style.setProperty("--sun-d", `${diameter.toFixed(1)}px`);

      origin.set(ox, oy, 0).project(camera);
      const sunY = (-origin.y * 0.5 + 0.5) * rect.height;

      s.style.right = `${(rect.width - xLeft).toFixed(1)}px`;
      s.style.top = `${sunY.toFixed(1)}px`;
      l.style.left = `${xRight.toFixed(1)}px`;
      l.style.top = `${sunY.toFixed(1)}px`;

      gsap.set([s, l], { y: 0 });
      const sRect = s.getBoundingClientRect();
      const lRect = l.getBoundingClientRect();
      const sDelta = rect.top + sunY - (sRect.top + sRect.height / 2);
      const lDelta = rect.top + sunY - (lRect.top + lRect.height / 2);
      gsap.set(s, { y: sDelta });
      gsap.set(l, { y: lDelta });

      // "Project" used to be centred for free by `left-0 right-0` spanning
      // a container that was already sun-width — now that the container is
      // the full viewport (see the note above `SystemOffset`), that CSS
      // centring centres it on the *screen*, not the sun, so it stops
      // following once the star sits off-centre. Centred here explicitly
      // on the same xLeft/xRight the sun itself is measured from instead.
      const sunCenterX = (xLeft + xRight) / 2;
      const rowTop = sunY - Math.max(sRect.height, lRect.height) / 2;
      const projectRect = p.getBoundingClientRect();
      p.style.left = `${(sunCenterX - projectRect.width / 2).toFixed(1)}px`;
      p.style.top = `${(rowTop - projectRect.height - 10).toFixed(1)}px`;
    };
    gsap.ticker.add(syncWordmark);

    // A visitor can click/Enter to advance before the scene has even
    // finished mounting (the click-catcher is live from the first paint).
    // In that case the intro never gets to play at all — jump straight to
    // the settled state instead of starting a dolly nobody will see, whose
    // scheduled hint would otherwise fire later and reappear over the
    // already-arrived layout.
    if (prefersReducedMotion() || arrivedRef.current) {
      camera.position.z = CAM_REST_Z;
      settleRef.current = 1;
      planetRefs.current.forEach((p) => (p.reveal.current = 1));
      syncWordmark();
      showWordmark(true);
      if (!arrivedRef.current) revealHint();
      return;
    }

    const DOLLY_DURATION = 4.4;
    const tl = gsap.timeline();
    tl.to(camera.position, { z: CAM_REST_Z, duration: DOLLY_DURATION, ease: "power2.inOut" }, 0);
    tl.to(settleRef, { current: 1, duration: DOLLY_DURATION, ease: "power2.inOut" }, 0);

    // Innermost shell resolves first — the camera passes them earliest — each
    // planet popping into being rather than simply fading, so the reveal
    // reads as discovery, not a cross-dissolve.
    [...APPS]
      .sort((a, b) => a.orbit.a - b.orbit.a)
      .forEach((app, i) => {
        const entry = planetRefs.current.get(app.id);
        if (!entry) return;
        tl.to(entry.reveal, { current: 1, duration: 1.1, ease: "back.out(1.6)" }, 0.9 + i * 0.22);
      });

    // Guarded against `arrivedRef`, not just scheduled: advance()'s
    // `progress(1)` jump-to-end fires every call the timeline passes over,
    // including ones beyond where it was actually interrupted, so a click
    // mid-dolly must not let this reopen the hint it just asked to hide.
    tl.call(() => showWordmark(false), undefined, DOLLY_DURATION + 0.1);
    tl.call(() => { if (!arrivedRef.current) revealHint(); }, undefined, DOLLY_DURATION + 0.9);
    introTlRef.current = tl;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The page can't actually scroll until there's something to scroll past —
  // locked during the reveal so a stray wheel/swipe can't skip the pinned
  // map transition before it's even been set up.
  useEffect(() => {
    document.body.style.overflow = phase === "reveal" ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      mapTlRef.current?.scrollTrigger?.kill();
      mapTlRef.current?.kill();
    };
  }, []);

  // Keep the "docked" offset in step with the viewport — e.g. a
  // desktop↔mobile breakpoint crossing, or just resizing the window.
  useEffect(() => {
    const onResize = () => {
      if (!arrivedRef.current) return;
      Object.assign(offsetRef.current, restOffset());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== "arrived") return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    dragRef.current = { on: true, x: e.clientX, y: e.clientY };
    rotRef.current.vYaw = 0;
    rotRef.current.vPitch = 0;
    rotRef.current.dragging = true;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.on) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    const yawStep = dx * 0.006;
    // Positive dy (dragging down) increases pitch — the near side follows
    // the pointer down, the direct-manipulation feel of spinning a globe by
    // hand rather than panning a camera around it.
    const pitchStep = dy * 0.005;
    rotRef.current.yaw += yawStep;
    rotRef.current.pitch = clamp(rotRef.current.pitch + pitchStep, -0.55, 0.95);
    rotRef.current.vYaw = yawStep;
    rotRef.current.vPitch = pitchStep;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.on) return;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* the pointer was never captured */
    }
    dragRef.current.on = false;
    rotRef.current.dragging = false;
    setDragging(false);
  };

  const arrived = phase === "arrived";

  return (
    <>
    <section ref={rootRef} className="relative h-[100svh] w-full overflow-hidden bg-void">
      <div className="starfield" />
      <div className="starfield starfield--far" />

      {/* the 3D scene — always full-bleed, in both phases. "Docking" is the
          star system leaning within it (see `offsetRef`), never the canvas
          being resized or cropped, so the particle field and starfield keep
          spanning the whole screen, including behind the text panel. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        className={`absolute inset-0 z-0 select-none ${arrived ? "touch-none" : ""} ${
          arrived ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""
        }`}
      >
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          style={{ position: "absolute", inset: 0 }}
        >
          <ExperienceScene
            onReady={handleReady}
            rotRef={rotRef}
            layoutRef={layoutRef}
            offsetRef={offsetRef}
            scaleRef={scaleRef}
            mapRevealRef={mapRevealRef}
            focusRef={focusRef}
            showLabels={labelsVisible}
            interactive={arrived}
          />
        </Canvas>
      </div>

      {/* the "Project S☉L" wordmark — a plain, never-transformed overlay
          spanning the whole viewport; syncWordmark positions its three spans
          in real screen pixels, already accounting for the star's current
          world offset */}
      <div
        ref={wordmarkRef}
        style={{ "--sun-d": "150px" } as React.CSSProperties}
        className="pointer-events-none absolute inset-0 z-[1] select-none"
      >
        <div
          ref={projectRef}
          className="pointer-events-none absolute whitespace-nowrap font-mono uppercase tracking-[0.5em] opacity-0"
          style={{
            color: "#FFFFFF",
            fontSize: "clamp(13.2px, calc(var(--sun-d) * 0.144), 18px)",
          }}
        >
          Project
        </div>
        <span
          ref={nLetterRef}
          className="pointer-events-none absolute font-sans font-semibold text-ink opacity-0"
          style={{ fontSize: "calc(var(--sun-d) * 0.9)", lineHeight: 1 }}
        >
          N
        </span>
        <span
          ref={xLetterRef}
          className="pointer-events-none absolute font-sans font-semibold text-ink opacity-0"
          style={{ fontSize: "calc(var(--sun-d) * 0.9)", lineHeight: 1 }}
        >
          X
        </span>
      </div>

      {/* the opening pitch — off-screen and inert during the reveal, fades
          and slides in once arrived; no background of its own, so the
          galaxy behind it (now full-bleed) shows through around the text */}
      <div
        ref={textPanelRef}
        className={`pointer-events-none absolute inset-x-0 top-0 z-[2] flex flex-col justify-center px-6 opacity-0 sm:px-10 lg:px-14 ${
          arrived ? "h-[40%] lg:h-full lg:w-[42%] lg:pointer-events-auto" : "h-full"
        }`}
      >
        <span className="mb-[20px] flex items-center gap-3">
          <span className="block h-px w-[22px] bg-[rgba(247,181,66,.7)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">
            Enterprise delivery
          </span>
        </span>
        <h1 className="max-w-[560px] text-[32px] font-semibold leading-[1.06] tracking-[-0.024em] text-ink sm:text-[44px] lg:text-[52px] [text-wrap:balance]">
          One <Accent>sentence</Accent>, shipped across the enterprise.
        </h1>
        <p className="mt-[22px] max-w-[480px] text-[15px] leading-[1.62] text-ink-muted lg:text-base [text-wrap:pretty]">
          Hundreds of applications, dozens of teams, contracts no one sees in full. NoX keeps a living map of
          that estate and carries each change from a business user&rsquo;s first sentence to shipped software
          &mdash; across every team and system it touches.
        </p>
      </div>

      {/* the map pitch — stacked exactly on top of the opening pitch above;
          setupMapScroll cross-fades between the two as the visitor scrolls
          through the pinned beat, so it reads as one panel's text changing,
          not two panels in different places */}
      <div
        ref={mapPanelRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex h-[40%] flex-col justify-center px-6 opacity-0 sm:px-10 lg:h-full lg:w-[42%] lg:px-14"
      >
        <span className="mb-[20px] flex items-center gap-3">
          <span className="block h-px w-[22px] bg-[rgba(247,181,66,.7)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">The enterprise map</span>
        </span>
        <h2 className="max-w-[520px] text-[32px] font-semibold leading-[1.1] tracking-[-0.024em] text-ink sm:text-[42px] lg:text-[46px] [text-wrap:balance]">
          One map of every application your <Accent>enterprise</Accent> runs.
        </h2>
        <p className="mt-[22px] max-w-[440px] text-[15px] leading-[1.62] text-ink-muted lg:text-base [text-wrap:pretty]">
          Every system, the contracts between them, and the team that owns each one &mdash; read
          continuously from code and docs, checked on every push. Change one application and you see which
          others feel it before anything ships.
        </p>
      </div>

      {/* the sources pitch — beat 3: the camera has flown in to one application
          and its knowledge sources orbit it as moons, feeding one knowledge base */}
      <div
        ref={sourcesPanelRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex h-[40%] flex-col justify-center px-6 opacity-0 sm:px-10 lg:h-full lg:w-[40%] lg:px-14"
      >
        <span className="mb-[20px] flex items-center gap-3">
          <span className="block h-px w-[22px] bg-[rgba(247,181,66,.7)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">One application, up close</span>
        </span>
        <h2 className="max-w-[520px] text-[32px] font-semibold leading-[1.1] tracking-[-0.024em] text-ink sm:text-[42px] lg:text-[46px] [text-wrap:balance]">
          Every source, <Accent>one</Accent> knowledge base.
        </h2>
        <p className="mt-[22px] max-w-[440px] text-[15px] leading-[1.62] text-ink-muted lg:text-base [text-wrap:pretty]">
          What a team knows about its application is scattered across tools &mdash; code in GitHub, tickets
          in Jira, decisions in Confluence, threads in Slack, specs in Notion. NoX reads them continuously
          into one knowledge base per application, every fact linked back to its source.
        </p>
        <ul className="mt-6 hidden max-w-[440px] flex-col gap-2.5 text-[14px] text-ink-muted lg:flex">
          {["Kept current on every push and every edit", "Versioned in Git, reviewed like code", "Shared by every team that depends on it"].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <Check className="mt-[3px] shrink-0" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      {/* beat 4 — the spec book; its own timeline is nested into the scrub above */}
      <div ref={bookWrapRef} className="pointer-events-none absolute inset-0 z-[2] opacity-0">
        <SpecBook ref={bookRef} onSeek={(t) => seekTo(bookAtRef.current + t)} />
      </div>

      {/* the way in — beat 6, the end of the pin: one large Enter NoX with
          the same liquid-metal finish as the one in the corner */}
      <div
        ref={launchPanelRef}
        className="invisible absolute inset-0 z-[2] flex flex-col items-center justify-center px-6 text-center opacity-0 sm:px-10"
      >
        <span className="mb-[20px] flex items-center gap-3">
          <span className="block h-px w-[22px] bg-[rgba(247,181,66,.7)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">Awaiting launch</span>
          <span className="block h-px w-[22px] bg-[rgba(247,181,66,.7)]" />
        </span>
        <h2 className="max-w-[640px] text-[28px] font-semibold leading-[1.1] tracking-[-0.024em] text-ink sm:text-[36px] lg:text-[44px] [text-wrap:balance]">
          From a sentence to <Accent>shipped software</Accent>.
        </h2>
        <LiquidMetalLink
          href="/login"
          glow={1}
          className="mt-12 inline-flex h-16 items-center rounded-full px-12 font-mono text-[15px] font-medium uppercase tracking-[0.2em] sm:h-[76px] sm:px-16 sm:text-[17px]"
        >
          Enter NoX
        </LiquidMetalLink>
      </div>

      {/* one-time click/Enter affordance — a full-bleed catcher, retired once arrived */}
      {!arrived && (
        <button
          type="button"
          aria-label="Continue to NoX"
          onClick={advance}
          className="absolute inset-0 z-[5] cursor-pointer bg-transparent"
        />
      )}
      <div
        ref={hintRef}
        className="pointer-events-none absolute bottom-10 left-1/2 z-[6] -translate-x-1/2 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.2em] text-ink-dim opacity-0"
      >
        Press enter or click to continue
      </div>

      {/* one-time affordance for the galaxy itself, once arrived — no CSS
          transition class here, since setupMapScroll's beat 3 also drives
          this element's opacity directly via GSAP (fading it out once the
          estate itself is gone); a CSS transition would fight the scrub,
          applying its own easing on top of every per-frame value GSAP sets. */}
      <div
        ref={dragHintRef}
        className={`pointer-events-none absolute bottom-6 z-[3] whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim ${
          arrived ? "opacity-100" : "opacity-0"
        } ${arrived ? "left-1/2 -translate-x-1/2 lg:left-auto lg:right-8 lg:translate-x-0" : ""}`}
      >
        Drag to turn the estate
      </div>
    </section>

    {/* the wordmark's resting place once the estate shrinks away — a small,
        fixed mark in the corner rather than the wordmark following it down
        to nothing. A true sibling of the pinned section, not a descendant:
        GSAP's pin here moves the section with a `transform`, not
        `position: fixed`, and a `fixed` element nested inside a transformed
        ancestor is contained by *that* ancestor instead of the viewport —
        it would travel with the pin instead of staying put in the corner.
        Appears in place rather than visibly travelling there: cross-faded
        in as the sun-tracking wordmark (inside the section, above) fades
        out, not the same element moved. */}
    <div
      ref={cornerWordmarkRef}
      className="pointer-events-none fixed left-5 top-5 z-[20] flex select-none flex-col opacity-0 sm:left-8 sm:top-6 lg:left-12 lg:top-7"
    >
      <span className="font-mono text-[8.5px] uppercase tracking-[0.42em] text-white/75">Project</span>
      <span className="mt-[3px] flex items-center font-sans text-[24px] font-semibold leading-none text-ink">
        N
        <span
          aria-hidden
          className="mx-[2px] inline-block rounded-full"
          style={{
            width: "0.76em",
            height: "0.76em",
            background: "radial-gradient(circle at 34% 30%, #FFF7E2, #FFDD82 42%, #F7B542 68%, #E9713C 100%)",
            boxShadow: "0 0 10px 2px rgba(247,181,66,.5)",
          }}
        />
        X
      </span>
    </div>
    </>
  );
}
