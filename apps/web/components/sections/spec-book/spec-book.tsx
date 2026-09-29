"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";

import { Planet } from "@/components/app/planet";
import { Accent } from "@/components/landing/primitives";
import { ROLE_BY_ID } from "@/lib/app/roles";
import { gsap } from "@/lib/motion";
import { BOOK_PAGES } from "@/lib/spec-book";
import BookScene, { type Pointer } from "./book-scene";
import { BOOK_SPAN, STEP_TIMES } from "./timeline";

/*
 * The spec-driven beat of the landing: one spec book, written page by page
 * by the four seats with NoX, then locked, sent for development and returned
 * verified. The landing's pinned scrub nests `build()`'s timeline, which
 * only moves `timeRef`; the scene derives everything else from it.
 */

export { BOOK_SPAN };

const CAPTIONS = [
  "A new requirement opens its spec book.",
  ...BOOK_PAGES.map((p) => `${ROLE_BY_ID[p.role].name} writes ${p.file}, with NoX.`),
  "Every seat signed. The book is locked.",
  "Sent for development.",
  "Back from the build, verified by every seat.",
];

export type SpecBookHandle = { build: () => gsap.core.Timeline };

const SpecBook = forwardRef<SpecBookHandle, { onSeek?: (localTime: number) => void }>(function SpecBook({ onSeek }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const pointerRef = useRef<Pointer>({ x: 0, y: 0 });
  const [step, setStep] = useState(0);

  useImperativeHandle(ref, () => ({
    build() {
      const tl = gsap.timeline();
      tl.fromTo(timeRef, { current: 0 }, { current: BOOK_SPAN, duration: BOOK_SPAN, ease: "none" }, 0);
      return tl;
    },
  }));

  // the landing fades this beat's wrapper in and out; draw only while it shows
  const isVisible = useCallback(() => {
    const wrap = rootRef.current?.parentElement;
    return !!wrap && parseFloat(wrap.style.opacity || "0") > 0.01;
  }, []);

  const steps = [
    ...BOOK_PAGES.map((p) => ({ key: p.role, label: ROLE_BY_ID[p.role].name, node: <Planet role={ROLE_BY_ID[p.role]} size={16} /> })),
    { key: "lock", label: "Locked", node: <LockIcon /> },
    { key: "done", label: "Verified", node: <span className="text-[13px] leading-none text-verify">✓</span> },
  ];
  const activeStep = step >= 7 ? 5 : step >= 5 ? 4 : step - 1;

  return (
    <div ref={rootRef} className="flex h-full w-full flex-col px-6 pb-4 pt-[84px] sm:px-10 lg:flex-row lg:items-center lg:gap-6 lg:px-14 lg:pb-0 lg:pt-0">
      <div className="shrink-0 lg:w-[30%]">
        <span className="mb-[16px] flex items-center gap-3">
          <span className="block h-px w-[22px] bg-[rgba(247,181,66,.7)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">Spec-driven development</span>
        </span>
        <h2 className="max-w-[420px] text-[28px] font-semibold leading-[1.1] tracking-[-0.024em] text-ink sm:text-[36px] lg:text-[44px] [text-wrap:balance]">
          Four seats. <Accent>One</Accent> spec book.
        </h2>
        <p className="mt-4 min-h-[48px] max-w-[380px] text-[15px] leading-[1.55] text-ink-muted lg:text-[16px]" aria-live="polite">
          {CAPTIONS[step]}
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
          <BookScene timeRef={timeRef} pointerRef={pointerRef} isVisible={isVisible} onStep={setStep} />
        </Canvas>
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

export default SpecBook;
