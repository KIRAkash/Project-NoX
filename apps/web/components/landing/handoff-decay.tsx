"use client";

import { useRef } from "react";
import { gsap, useGSAP, useReveal, prefersReducedMotion } from "@/lib/motion";
import { HANDOFFS } from "@/lib/content";
import { Accent, Section, SectionHead } from "./primitives";

export default function HandoffDecay() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      // Each column's fidelity bar grows to its true width as the grid enters,
      // so the decay reads left to right as one gesture.
      gsap.fromTo(
        "[data-fidelity]",
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 1,
          ease: "power2.out",
          stagger: 0.12,
          scrollTrigger: { trigger: "[data-decay-grid]", start: "top 80%", once: true },
        },
      );
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <Section>
        <SectionHead
          eyebrow="01 — The problem"
          title={
            <>
              Nothing is lost in the work.
              <br className="hidden lg:block" /> It is lost <Accent tone="ember">between</Accent> the work.
            </>
          }
          lede="A change request passes through four or five people before code is written. Each handoff re-types the specification, dropping unshared context and edge cases."
        />

        <div
          data-decay-grid
          className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-5"
        >
          {HANDOFFS.map((h, i) => (
            <div key={h.stage} className="flex flex-col gap-4 bg-hull px-6 pb-[30px] pt-7">
              <div
                className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
                style={{ color: `rgba(236,239,248,${1 - i * 0.14})` }}
              >
                {h.stage}
              </div>
              <div className="h-[2px] w-full overflow-hidden">
                <div
                  data-fidelity
                  className="h-full"
                  style={{
                    width: `${h.fidelity}%`,
                    background: `linear-gradient(90deg, rgba(247,181,66,${h.fidelity / 110}), rgba(247,181,66,.06))`,
                  }}
                />
              </div>
              <p className="text-[13.5px] leading-[1.6] text-ink-muted">{h.line}</p>
              <p className="text-[12.5px] leading-[1.55] text-ink-faint">{h.loss}</p>
            </div>
          ))}
        </div>

        <div data-reveal className="mt-14 flex items-center gap-5">
          <span className="block h-px w-11 shrink-0 bg-[rgba(247,181,66,.7)]" />
          <p className="text-lg font-medium leading-[1.5] tracking-[-0.012em] text-ink lg:text-[22px]">
            NoX closes the gap by being the one thing every stage shares: an accurate, current model of
            the system the change is about.
          </p>
        </div>
      </Section>
    </div>
  );
}
