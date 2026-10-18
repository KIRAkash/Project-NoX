"use client";

import { Lockup, Tagline } from "@/components/landing/lockups";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";

import { Planet } from "@/components/app/planet";
import { Accent } from "@/components/landing/primitives";
import { ROLE_BY_ID } from "@/lib/app/roles";
import { useTheme } from "@/lib/app/theme";
import { gsap } from "@/lib/motion";
import { BOOK_PAGES } from "@/lib/spec-book";
import BookScene, { type Anchor, type Pointer } from "./book-scene";
import HandoffOverlay from "./handoff-overlay";
import { BOOK_SPAN, STEP_TIMES } from "./timeline";

/*
 * The spec-driven beat of the landing: one spec book, written page by page
 * by the four seats with NoX, then locked and handed to the coding agents:
 * Antigravity builds from it with the knowledge at hand, and the work comes
 * back verified. The landing's pinned scrub nests `build()`'s timeline, which
 * only moves `timeRef`; the scene derives everything else from it.
 */

export { BOOK_SPAN };

const CAPTIONS = [
  "A new requirement opens its spec book.",
  ...BOOK_PAGES.map((p) => `${ROLE_BY_ID[p.role].name} writes ${p.file}, with NoX.`),
  "Four approved files, one per seat. Nothing gets built from a draft.",
  "Every coding agent with /nox reads the same book.",
  "Antigravity runs /nox NOX-1 and builds with the book and the knowledge base at hand.",
  "The work comes back to the book, verified by every seat.",
];

/** The heading follows the story: writing, locked, handed off, building, verified. Indexed by step. */
const HEADINGS: { key: string; node: ReactNode }[] = [
  { key: "write", node: <>Four seats. <Accent>One</Accent> spec book.</> },
  { key: "locked", node: <>Every seat signed. <Accent>Locked.</Accent></> },
  { key: "handoff", node: <>One book. <Accent>Any</Accent> coding agent.</> },
  { key: "build", node: <>Built where the developer <Accent>works</Accent>.</> },
  { key: "verified", node: <>Built from the book. <Accent tone="verify">Verified</Accent>.</> },
];
const headingFor = (step: number) => HEADINGS[step >= 8 ? 4 : step >= 7 ? 3 : step >= 6 ? 2 : step >= 5 ? 1 : 0];

export type SpecBookHandle = { build: () => gsap.core.Timeline };

const SpecBook = forwardRef<SpecBookHandle, { onSeek?: (localTime: number) => void }>(function SpecBook({ onSeek }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const pointerRef = useRef<Pointer>({ x: 0, y: 0 });
  const anchorRef = useRef<Anchor | null>(null);
  const [step, setStep] = useState(0);

  useImperativeHandle(ref, () => ({
    build() {
      const tl = gsap.timeline();
      tl.fromTo(timeRef, { current: 0 }, { current: BOOK_SPAN, duration: BOOK_SPAN, ease: "none" }, 0);
      return tl;
    },
  }));

  // the landing fades this beat's wrapper in and out; draw only while it shows
  const light = useTheme().theme === "light";
  const isVisible = useCallback(() => {
    const wrap = rootRef.current?.parentElement;
    return !!wrap && parseFloat(wrap.style.opacity || "0") > 0.01;
  }, []);

  const steps = [
    ...BOOK_PAGES.map((p) => ({ key: p.role, label: ROLE_BY_ID[p.role].name, node: <Planet role={ROLE_BY_ID[p.role]} size={16} /> })),
    { key: "lock", label: "Locked", node: <LockIcon /> },
    { key: "build", label: "Built by a coding agent", node: <BuildIcon /> },
    { key: "done", label: "Verified", node: <span className="text-[13px] leading-none text-verify">✓</span> },
  ];
  const activeStep = step >= 8 ? 6 : step >= 6 ? 5 : step >= 5 ? 4 : step - 1;

  return (
    <div ref={rootRef} className="flex h-full w-full flex-col px-6 pb-4 pt-[84px] sm:px-10 lg:flex-row lg:items-center lg:gap-6 lg:px-14 lg:pb-0 lg:pt-0">
      <div className="shrink-0 lg:w-[30%]">
        <Lockup name="missions" className="-ml-[8px] h-[56px] sm:h-[88px] lg:h-[100px]" />
        <Tagline className="mb-[18px] mt-[2px]">
          Every change, <Accent>delivered</Accent>.
        </Tagline>
        {/* a fixed two-line box, so the steps below don't jump when the heading changes */}
        <h2 className="min-h-[2.2em] max-w-[420px] text-[28px] font-semibold leading-[1.1] tracking-[-0.024em] text-ink sm:text-[36px] lg:text-[44px] [text-wrap:balance]">
          <span key={headingFor(step).key} className="beat-in block">
            {headingFor(step).node}
          </span>
        </h2>
        <p className="mt-4 min-h-[48px] max-w-[380px] text-[15px] leading-[1.55] text-ink-muted lg:text-[16px]" aria-live="polite">
          <span key={step} className="beat-in block">
            {CAPTIONS[step]}
          </span>
        </p>

        {/* where the story is; each step jumps the page there */}
        <ol className="mt-4 flex items-center gap-1 lg:mt-8">
          {steps.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                title={s.label}
                aria-label={s.label}
                onClick={() => onSeek?.(STEP_TIMES[i])}
                className={`flex h-9 w-9 items-center justify-center rounded-full border transition duration-300 ${
                  i === activeStep
                    ? "border-[rgba(247,181,66,.55)] bg-[rgba(247,181,66,.08)]"
                    : i < activeStep
                      ? "border-hairline opacity-100"
                      : "border-transparent opacity-40 hover:opacity-80"
                }`}
              >
                {s.node}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div
        className="relative min-h-0 flex-1 self-stretch"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          pointerRef.current = { x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 };
        }}
        onPointerLeave={() => {
          pointerRef.current = { x: 0, y: 0 };
        }}
      >
        <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 30, position: [0, 0, 7] }} gl={{ antialias: true, alpha: true }} style={{ position: "absolute", inset: 0 }}>
          <BookScene timeRef={timeRef} pointerRef={pointerRef} isVisible={isVisible} onStep={setStep} anchorRef={anchorRef} light={light} />
        </Canvas>
        <HandoffOverlay timeRef={timeRef} anchorRef={anchorRef} isVisible={isVisible} />
      </div>
    </div>
  );
});

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#E8C27A" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="#E8C27A" />
    </svg>
  );
}

function BuildIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" stroke="#E8C27A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default SpecBook;
