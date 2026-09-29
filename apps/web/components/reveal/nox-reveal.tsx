"use client";

import { useRef } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { gsap, prefersReducedMotion } from "@/lib/motion";
import { APPS } from "@/lib/content";
import RevealScene, { SUN_R, CAM_REST_Z, type SceneHandle } from "./reveal-scene";

/*
 * A pure graphic reveal, nothing else on the page: extreme close on the
 * star's corona, a camera dolly out through the particle field as the
 * estate resolves into view, then the wordmark assembles once it settles —
 * the star itself standing in for the O in "NOX". GSAP owns this one-time
 * sequence, driving the real Three.js camera and per-planet reveal values
 * directly; R3F's own loop (in reveal-scene.tsx) owns everything ambient.
 */

export default function NoxReveal() {
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const nLetterRef = useRef<HTMLSpanElement>(null);
  const xLetterRef = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);

  const showWordmark = (instant: boolean) => {
    const nGlyph = nLetterRef.current;
    const xGlyph = xLetterRef.current;
    const p = projectRef.current;
    if (!nGlyph || !xGlyph || !p) return;
    if (instant) {
      gsap.set([nGlyph, xGlyph, p], { opacity: 1, x: 0, y: 0 });
      return;
    }
    // Only x (the slide-in) and opacity are one-time here — y on N/X is
    // owned by the continuous sync below, so the two never fight over the
    // same transform.
    gsap
      .timeline()
      .fromTo(nGlyph, { opacity: 0, x: -36 }, { opacity: 1, x: 0, duration: 0.9, ease: "back.out(1.5)" }, 0)
      .fromTo(xGlyph, { opacity: 0, x: 36 }, { opacity: 1, x: 0, duration: 0.9, ease: "back.out(1.5)" }, 0)
      .fromTo(p, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.45);
  };

  const handleReady = (handle: SceneHandle) => {
    if (startedRef.current) return;
    startedRef.current = true;

    const { camera, planetRefs, settleRef } = handle;
    if (!camera) return;

    // Continuous, forever: the sun's true on-screen edges and centre, read
    // back each frame via real projection (never a hand-derived formula), so
    // the wordmark stays correct through the dolly, the ambient camera's
    // drift, and any window resize.
    //
    // N and X are positioned with plain `left`/`right`/`top` — never
    // `transform` — anchored directly to the sun's measured left and right
    // edges. Centring the N+gap+X *row* as one flex block was the earlier
    // bug: N and X are different glyph widths, so a centred row does not
    // centre the *gap* inside it, and the gap silently drifted off the
    // sun's true edges (touching on one side, visibly open on the other).
    // Anchoring each glyph straight to the projected edge removes that
    // assumption entirely.
    //
    // `transform` is left completely free for GSAP's own x/y (the entrance
    // slide-in, and — for the vertical centring, since cap-height sits above
    // the baseline and would otherwise render a touch high against a true
    // circle — a continuously updated `y` set every frame via GSAP itself,
    // never a raw style write, so the two never overwrite each other).
    const edgeA = new THREE.Vector3();
    const edgeB = new THREE.Vector3();
    const origin = new THREE.Vector3();
    const syncWordmark = () => {
      const el = wordmarkRef.current;
      const nGlyph = nLetterRef.current;
      const xGlyph = xLetterRef.current;
      const p = projectRef.current;
      if (!el || !nGlyph || !xGlyph || !p) return;
      const rect = el.getBoundingClientRect();

      edgeA.set(-SUN_R, 0, 0).project(camera);
      edgeB.set(SUN_R, 0, 0).project(camera);
      const xLeft = Math.min(edgeA.x, edgeB.x) * 0.5 * rect.width + rect.width / 2;
      const xRight = Math.max(edgeA.x, edgeB.x) * 0.5 * rect.width + rect.width / 2;
      const diameter = xRight - xLeft;
      el.style.setProperty("--sun-d", `${diameter.toFixed(1)}px`);

      origin.set(0, 0, 0).project(camera);
      const sunY = (-origin.y * 0.5 + 0.5) * rect.height; // container-relative

      nGlyph.style.right = `${(rect.width - xLeft).toFixed(1)}px`;
      nGlyph.style.top = `${sunY.toFixed(1)}px`;
      xGlyph.style.left = `${xRight.toFixed(1)}px`;
      xGlyph.style.top = `${sunY.toFixed(1)}px`;

      // Clear any prior GSAP-owned y before re-measuring, so the correction
      // is against each glyph's true untransformed position, not the last
      // frame's already-corrected one.
      gsap.set([nGlyph, xGlyph], { y: 0 });
      const nRect = nGlyph.getBoundingClientRect();
      const xRect = xGlyph.getBoundingClientRect();
      const nDelta = rect.top + sunY - (nRect.top + nRect.height / 2);
      const xDelta = rect.top + sunY - (xRect.top + xRect.height / 2);
      gsap.set(nGlyph, { y: nDelta });
      gsap.set(xGlyph, { y: xDelta });

      // "Project" sits a fixed margin above the N/O/X row's true visual top
      // edge — measured directly, not a guessed multiple of the sun's
      // diameter, so it can never overlap regardless of font metrics or how
      // large the sun renders.
      const rowTop = sunY - Math.max(nRect.height, xRect.height) / 2;
      const projectHeight = p.getBoundingClientRect().height;
      p.style.top = `${(rowTop - projectHeight - 10).toFixed(1)}px`;
    };
    gsap.ticker.add(syncWordmark);

    if (prefersReducedMotion()) {
      camera.position.z = CAM_REST_Z;
      settleRef.current = 1;
      planetRefs.current.forEach((p) => (p.reveal.current = 1));
      syncWordmark();
      showWordmark(true);
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

    tl.call(() => showWordmark(false), undefined, DOLLY_DURATION + 0.1);
  };

  return (
    <main className="relative h-screen w-full overflow-hidden bg-void">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
      >
        <RevealScene onReady={handleReady} />
      </Canvas>

      <div
        ref={wordmarkRef}
        className="pointer-events-none absolute inset-0 select-none"
        style={{ "--sun-d": "150px" } as React.CSSProperties}
      >
        <div
          ref={projectRef}
          className="absolute left-0 right-0 whitespace-nowrap font-mono uppercase tracking-[0.5em] opacity-0"
          style={{
            color: "#FFFFFF",
            textAlign: "center",
            fontSize: "clamp(13.2px, calc(var(--sun-d) * 0.144), 18px)",
          }}
        >
          Project
        </div>
        <span
          ref={nLetterRef}
          className="absolute font-sans font-semibold text-ink opacity-0"
          style={{ fontSize: "calc(var(--sun-d) * 0.9)", lineHeight: 1 }}
        >
          N
        </span>
        <span
          ref={xLetterRef}
          className="absolute font-sans font-semibold text-ink opacity-0"
          style={{ fontSize: "calc(var(--sun-d) * 0.9)", lineHeight: 1 }}
        >
          X
        </span>
      </div>
    </main>
  );
}
