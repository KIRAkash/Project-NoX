"use client";

import { useRef } from "react";
import { gsap, useGSAP, useReveal, prefersReducedMotion } from "@/lib/motion";
import { CRITERIA, TRACE } from "@/lib/content";
import { Accent, Section, SectionHead, Warn } from "./primitives";

export default function Verification() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      // The provenance chain draws itself link by link, left to right.
      gsap.fromTo(
        "[data-trace-rule]",
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.5,
          ease: "power2.out",
          stagger: 0.1,
          scrollTrigger: { trigger: "[data-trace]", start: "top 80%", once: true },
        },
      );
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <Section id="verify" className="bg-[linear-gradient(180deg,#05060B_0%,#070911_55%,#05060B_100%)]">
        <SectionHead
          eyebrow="04 — The return"
          title={
            <>
              The change is judged
              <br className="hidden lg:block" /> against the <Accent tone="verify">sentence</Accent>.
            </>
          }
          lede="NoX replays the merged change against the original request and each intermediate specification, reporting what is verified in code with backing tests."
        />

        <div data-trace data-reveal className="mb-3 rounded-xl border border-hairline bg-hull px-6 pb-[34px] pt-[30px] lg:px-[34px]">
          <div className="mb-[22px] font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
            Provenance chain — CR-2291
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {TRACE.map((t) => (
              <div key={t.stage} className="flex flex-col gap-[9px]">
                <div
                  data-trace-rule
                  className="h-px"
                  style={{ background: "linear-gradient(90deg, rgba(247,181,66,.5), rgba(134,185,238,.5))" }}
                />
                <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
                  {t.stage}
                </div>
                <div className="break-words font-mono text-xs leading-[1.5] text-[#D6DCEC]">{t.ref}</div>
                <div className="text-[12.5px] leading-[1.5] text-ink-faint">{t.note}</div>
              </div>
            ))}
          </div>
        </div>

        <div data-reveal className="overflow-hidden rounded-xl border border-hairline bg-deck">
          <div className="flex flex-wrap items-center gap-4 border-b border-hairline px-6 py-[18px] lg:px-[34px]">
            <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
              Verification report
            </span>
            <span className="font-mono text-[11px] tracking-[0.08em] text-verify">4 satisfied</span>
            <span className="block h-3 w-px bg-[rgba(143,160,204,.24)]" />
            <span className="font-mono text-[11px] tracking-[0.08em] text-ember">1 gap</span>
          </div>

          {CRITERIA.map((c) => (
            <div
              key={c.source}
              className="flex flex-col gap-3 border-b border-[rgba(143,160,204,.09)] px-6 py-5 sm:flex-row sm:items-start sm:gap-[22px] lg:px-[34px]"
            >
              <span
                className={`w-[84px] shrink-0 rounded-sm border px-2.5 py-[5px] text-center font-mono text-[10px] uppercase tracking-[0.14em] ${
                  c.met
                    ? "border-[rgba(95,210,159,.35)] bg-[rgba(95,210,159,.06)] text-verify"
                    : "border-[rgba(233,113,60,.4)] bg-[rgba(233,113,60,.07)] text-ember"
                }`}
              >
                {c.met ? "Met" : "Gap"}
              </span>
              <div className="flex flex-1 flex-col gap-[7px]">
                <span className="text-[15px] leading-[1.5] text-ink">{c.text}</span>
                <span className="font-mono text-[11.5px] leading-[1.5] tracking-[0.04em] text-ink-faint">
                  {c.evidence}
                </span>
              </div>
              <span className="shrink-0 pt-[3px] font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
                {c.source}
              </span>
            </div>
          ))}

          <div className="flex items-start gap-3.5 bg-[rgba(233,113,60,.05)] px-6 py-5 lg:items-center lg:px-[34px]">
            <Warn />
            <span className="flex-1 text-sm leading-[1.55] text-[#D6DCEC]">
              The gap traces back to a missing clause in the technical spec, not to the code. NoX reopens
              stage 03 with the clause pre-drafted, and leaves the build untouched.
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}
