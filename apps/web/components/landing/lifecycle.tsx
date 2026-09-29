"use client";

import { useRef, useState } from "react";
import { gsap, ScrollTrigger, useGSAP, useReveal, prefersReducedMotion } from "@/lib/motion";
import { STAGES } from "@/lib/content";
import { Accent, Eyebrow } from "./primitives";

const TRAJECTORY = "M40 46 C 240 6, 420 6, 572 30 C 724 54, 904 54, 1104 14";
const RUNWAY = 3200; // px of scroll the pinned journey consumes

export default function Lifecycle() {
  const root = useRef<HTMLDivElement>(null);
  const runway = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const stage = STAGES[idx];

  useReveal(root);

  const select = (i: number) => {
    if (i === idxRef.current) return;
    idxRef.current = i;
    setIdx(i);
  };

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;

      const mm = gsap.matchMedia();

      // Only the desktop layout pins: on a phone a tall pinned panel traps the
      // reader, so there the stage buttons are simply tappable.
      mm.add("(min-width: 1024px)", () => {
        // No scrub on the pin trigger: scrub smooths `progress`, which would
        // make the stage index lag behind the probe. onUpdate already fires on
        // every scroll tick within range.
        const st = ScrollTrigger.create({
          trigger: runway.current,
          start: "top top",
          end: `+=${RUNWAY}`,
          pin: ".journey-pin",
          onUpdate(self) {
            select(Math.min(STAGES.length - 1, Math.floor(self.progress * STAGES.length)));
          },
          // Entering from far above or below skips onUpdate, so pin the ends.
          onLeaveBack: () => select(0),
          onLeave: () => select(STAGES.length - 1),
        });

        const probe = gsap.to(".probe", {
          motionPath: { path: "#trajectory", align: "#trajectory", alignOrigin: [0.5, 0.5] },
          ease: "none",
          scrollTrigger: {
            trigger: runway.current,
            start: "top top",
            end: `+=${RUNWAY}`,
            scrub: 0.4,
          },
        });

        const trail = gsap.fromTo(
          ".trail",
          { strokeDashoffset: 1200 },
          {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: {
              trigger: runway.current,
              start: "top top",
              end: `+=${RUNWAY}`,
              scrub: 0.4,
            },
          },
        );

        void st;
        void probe;
        void trail;
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  // Cross-fade the panel contents whenever the stage changes.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(
        panel.current,
        { opacity: 0.2, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
      );
    },
    { dependencies: [idx], scope: root },
  );

  return (
    <div ref={root}>
      <section id="lifecycle" className="relative w-full border-b border-hairline">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-10 h-[1100px] w-[1100px] -translate-x-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(134,185,238,.05) 0%, rgba(5,6,11,0) 62%)" }}
        />

        <div ref={runway} className="relative z-[2]">
          <div className="journey-pin mx-auto max-w-shell px-5 py-[72px] sm:px-8 lg:px-12 lg:py-[110px]">
            <div className="mb-12 flex flex-col gap-8 lg:flex-row lg:items-end lg:gap-[72px]">
              <div data-reveal data-reveal-group="lc" className="lg:w-[640px] lg:shrink-0">
                <Eyebrow>03 — The lifecycle</Eyebrow>
                <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.024em] text-ink sm:text-[42px] lg:text-[50px]">
                  One change.
                  <br className="hidden lg:block" /> Five <Accent>orbits</Accent>. No re-typing.
                </h2>
              </div>
              <p
                data-reveal
                data-reveal-group="lc"
                className="max-w-[420px] text-[15px] leading-[1.65] text-ink-muted lg:text-base [text-wrap:pretty]"
              >
                Every stage happens on NoX, and every stage is drafted against the atlas before a human
                reads it. The person reviews and approves &mdash; they never start from a blank page, and
                they never start from the wrong system.
              </p>
            </div>

            {/* trajectory and probe */}
            <svg viewBox="0 0 1144 60" className="mb-1 hidden h-[60px] w-full lg:block" aria-hidden="true">
              <path id="trajectory" d={TRAJECTORY} fill="none" stroke="rgba(143,160,204,.18)" strokeWidth="1" />
              <path
                className="trail"
                d={TRAJECTORY}
                fill="none"
                stroke="rgba(247,181,66,.55)"
                strokeWidth="1.2"
                strokeDasharray="1200"
                strokeDashoffset="1200"
              />
              <g className="probe">
                <circle r="13" fill="rgba(247,181,66,.18)" />
                <circle r="4" fill="#FFE2A6" />
              </g>
            </svg>

            {/* stage selector */}
            <div className="mb-[34px] grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {STAGES.map((s, i) => {
                const on = i === idx;
                return (
                  <button
                    key={s.no}
                    type="button"
                    onClick={() => select(i)}
                    aria-current={on}
                    className={`flex min-h-[72px] flex-col items-start gap-[7px] rounded-sm border px-4 pb-[17px] pt-4 text-left transition-colors duration-300 ${
                      on ? "border-nox bg-[rgba(247,181,66,.08)]" : "border-[rgba(143,160,204,.18)] bg-hull hover:border-[rgba(247,181,66,.45)]"
                    }`}
                  >
                    <span className="flex w-full items-center gap-[9px]">
                      <span
                        className={`rounded-sm px-1.5 py-[3px] font-mono text-[10px] tracking-[0.1em] ${
                          on ? "bg-nox text-[#120D04]" : "bg-[rgba(143,160,204,.12)] text-ink-faint"
                        }`}
                      >
                        {s.no}
                      </span>
                      <span
                        className={`font-mono text-[11px] uppercase tracking-[0.14em] ${on ? "text-ink" : "text-ink-muted"}`}
                      >
                        {s.name}
                      </span>
                    </span>
                    <span className="w-full text-[13px] leading-[1.4] text-ink-faint">{s.role}</span>
                  </button>
                );
              })}
            </div>

            {/* stage panel */}
            <div ref={panel} className="flex flex-col overflow-hidden rounded-xl border border-[rgba(143,160,204,.16)] bg-deck lg:flex-row">
              <div className="flex shrink-0 flex-col gap-6 border-b border-hairline px-6 pb-9 pt-8 lg:w-[452px] lg:border-b-0 lg:border-r lg:px-9">
                <div>
                  <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-nox">
                    {stage.no} / {stage.name}
                  </div>
                  <h3 className="mb-3.5 text-[26px] font-semibold leading-[1.16] tracking-[-0.02em] text-ink lg:text-[30px]">
                    {stage.headline}
                  </h3>
                  <p className="text-[15px] leading-[1.64] text-ink-muted">{stage.body}</p>
                </div>
                <dl className="flex flex-col gap-3.5 border-t border-hairline pt-5">
                  <Row label="In" value={stage.input} />
                  <Row label="Out" value={stage.output} />
                  <Row label="Gate" value={stage.gate} />
                </dl>
              </div>

              <div className="flex flex-1 flex-col gap-[22px] px-6 pb-9 pt-[30px] lg:px-[34px]">
                {/* the document this stage produces */}
                <div className="overflow-hidden rounded-sm border border-[rgba(143,160,204,.18)] bg-void">
                  <div className="flex items-center gap-2.5 border-b border-hairline bg-[rgba(143,160,204,.04)] px-4 py-[11px]">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3.4 1.8h6.1l3.1 3.2v9.2H3.4V1.8Z" stroke="#7C86A3" strokeWidth="1.2" strokeLinejoin="round" />
                      <path d="M9.4 1.9V5h3.1" stroke="#7C86A3" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                    <span className="flex-1 font-mono text-[11px] tracking-[0.06em] text-ink-muted">
                      {stage.docName}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-dim">
                      {stage.docMeta}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[13px] px-[22px] pb-6 pt-5">
                    <div className="font-display text-xl leading-[1.3] text-ink">{stage.docTitle}</div>
                    {stage.docLines.map((l) => (
                      <div key={l.tag} className="flex items-baseline gap-[14px]">
                        <span className="w-11 shrink-0 font-mono text-[10.5px] text-ink-dim">{l.tag}</span>
                        <span className="flex-1 text-[13.5px] leading-[1.58] text-[#C2C9DD]">{l.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* what the atlas contributed */}
                <div className="flex flex-col gap-[13px]">
                  <div className="flex items-center gap-2.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" fill="#F7B542" />
                      <circle cx="12" cy="12" r="9.4" stroke="rgba(247,181,66,.4)" strokeWidth="1" strokeDasharray="2.4 3.2" />
                    </svg>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
                      Checked against the atlas
                    </span>
                  </div>
                  {stage.checks.map((c) => (
                    <div
                      key={c.label}
                      className="flex flex-col gap-1.5 border-l border-[rgba(134,185,238,.34)] bg-[rgba(134,185,238,.04)] px-3.5 py-[11px] sm:flex-row sm:gap-3"
                    >
                      <span className="w-24 shrink-0 font-mono text-[10.5px] uppercase leading-[1.5] tracking-[0.08em] text-ice">
                        {c.label}
                      </span>
                      <span className="flex-1 text-[13px] leading-[1.55] text-[#C2C9DD]">{c.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="w-[62px] shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
        {label}
      </dt>
      <dd className="m-0 text-[13.5px] leading-[1.55] text-[#D6DCEC]">{value}</dd>
    </div>
  );
}
