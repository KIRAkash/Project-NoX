"use client";

import { useRef } from "react";
import { useReveal } from "@/lib/motion";
import { STATIONS } from "@/lib/content";
import { Accent, Section, SectionHead } from "./primitives";

const TONE = { nox: "#F7B542", ice: "#86B9EE", verify: "#5FD29F" } as const;

export default function GroundStations() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  return (
    <div ref={root}>
      <Section>
        <SectionHead
          eyebrow="05 — Ground stations"
          title={
            <>
              Nobody has to
              <br className="hidden lg:block" /> leave their <Accent tone="ice">tools</Accent>.
            </>
          }
          lede="NoX orchestrates the delivery lifecycle across your existing tools. Approved documents write out to the systems your company already audits, and external edits stream back."
        />

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
          {STATIONS.map((s) => (
            <div
              key={s.name}
              data-reveal
              data-reveal-group="stations"
              className="flex flex-col gap-3.5 border border-transparent bg-hull px-[26px] pb-[30px] pt-7 transition-[border-color,transform] duration-300 hover:-translate-y-[3px] hover:border-[rgba(143,160,204,.3)]"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`block h-[22px] w-[22px] shrink-0 border ${
                    s.shape === "round" ? "rounded-full" : s.shape === "diamond" ? "rotate-45 rounded-[2px]" : "rounded-[2px]"
                  }`}
                  style={{ borderColor: `${TONE[s.tone]}8c` }}
                />
                <span className="flex-1 text-base font-semibold tracking-[-0.01em] text-ink">{s.name}</span>
                <span
                  className="font-mono text-[9.5px] uppercase tracking-[0.14em]"
                  style={{ color: TONE[s.tone] }}
                >
                  {s.dir}
                </span>
              </div>
              <p className="text-[13.5px] leading-[1.62] text-ink-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
