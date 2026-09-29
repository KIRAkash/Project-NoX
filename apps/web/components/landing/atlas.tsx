"use client";

import { useRef, useState } from "react";
import { gsap, useGSAP, useReveal, prefersReducedMotion } from "@/lib/motion";
import { APPS, COMPILER_RULES } from "@/lib/content";
import { Accent, Section, SectionHead, Warn } from "./primitives";

const TIER_DOT = { core: "#F7B542", service: "#86B9EE", edge: "#6E7793" } as const;

export default function Atlas() {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(APPS[0].id);
  const app = APPS.find((a) => a.id === selected) ?? APPS[0];

  useReveal(root);

  // Re-enter the detail panel whenever the selection changes, so switching
  // applications feels like retuning an instrument rather than a DOM swap.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(
        panel.current,
        { opacity: 0.25, y: 10 },
        { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" },
      );
    },
    { dependencies: [selected], scope: root },
  );

  return (
    <div ref={root}>
      <Section
        id="atlas"
        className="bg-[linear-gradient(180deg,#05060B_0%,#070911_50%,#05060B_100%)]"
      >
        <div className="starfield starfield--far opacity-55" />

        <SectionHead
          eyebrow="02 — The atlas"
          title={
            <>
              NoX already knows
              <br className="hidden lg:block" /> your <Accent>system</Accent>.
            </>
          }
          lede="Point NoX at a repository and it compiles a code wiki. Point it at the next one and it starts drawing the lines between them — route calls, event topics, shared schemas, ownership. The map maintains itself on every push."
        />

        <div data-reveal className="flex flex-col gap-px overflow-hidden rounded-xl border border-hairline bg-hairline lg:flex-row">
          {/* application list */}
          <div className="w-full shrink-0 bg-hull py-[22px] lg:w-[306px]">
            <div className="px-[22px] pb-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-dim">
              Applications
            </div>
            <div className="flex overflow-x-auto lg:flex-col lg:overflow-visible">
              {APPS.map((a) => {
                const on = a.id === selected;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelected(a.id)}
                    aria-current={on}
                    className={`flex min-h-[60px] w-full min-w-[220px] items-center gap-[13px] border-l-2 px-[22px] py-[14px] text-left transition-colors duration-200 ${
                      on
                        ? "border-nox bg-[rgba(247,181,66,.07)]"
                        : "border-transparent hover:bg-[rgba(134,185,238,.05)]"
                    }`}
                  >
                    <span
                      className="block h-[7px] w-[7px] shrink-0 rounded-full transition-shadow"
                      style={{
                        background: TIER_DOT[a.tier],
                        boxShadow: on ? "0 0 0 4px rgba(247,181,66,.14)" : "none",
                      }}
                    />
                    <span className="flex flex-1 flex-col items-start gap-[3px]">
                      <span className="text-sm font-medium tracking-[-0.005em] text-ink">{a.name}</span>
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
                        {a.kind}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={`shrink-0 text-sm transition-opacity ${on ? "text-nox opacity-100" : "opacity-0"}`}
                    >
                      &rarr;
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* detail */}
          <div ref={panel} className="flex flex-1 flex-col gap-[26px] bg-deck px-6 pb-9 pt-8 lg:px-[38px]">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-5">
              <div className="flex-1">
                <h3 className="mb-2 text-[27px] font-semibold tracking-[-0.018em] text-ink">{app.name}</h3>
                <p className="max-w-[560px] text-[15px] leading-[1.6] text-ink-muted">{app.summary}</p>
              </div>
              <div className="shrink-0 rounded-sm border border-[rgba(95,210,159,.3)] px-[11px] py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-verify">
                {app.freshness}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-7 sm:grid-cols-3">
              <Column title="Owns" rows={app.owns} rule="rgba(247,181,66,.4)" />
              <Column title="Depends on" rows={app.depends} rule="rgba(134,185,238,.4)" />
              <Column title="Breaks if changed" rows={app.breaks} rule="rgba(233,113,60,.45)" />
            </div>

            <div className="flex flex-col gap-3 border-t border-hairline pt-[22px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
                Contracts held with other applications
              </div>
              {app.contracts.map((c) => (
                <div
                  key={c.left}
                  className="flex flex-wrap items-baseline gap-x-[14px] gap-y-1 font-mono text-xs leading-[1.6]"
                >
                  <span className="w-[62px] shrink-0 text-nox">{c.kind}</span>
                  <span className="flex-1 text-[#D6DCEC]">{c.left}</span>
                  <span className="text-ink-dim">&rarr;</span>
                  <span className="shrink-0 text-ice lg:w-[290px]">{c.right}</span>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-3 border-t border-hairline pt-5">
              <Warn color="#F7B542" size={14} />
              <p className="text-[13px] leading-[1.6] text-ink-muted">{app.guardrail}</p>
            </div>
          </div>
        </div>

        {/* why the map can be trusted */}
        <div className="mt-[76px]">
          <div data-reveal className="mb-[34px] flex flex-wrap items-baseline gap-x-[18px] gap-y-2">
            <h3 className="text-[26px] font-semibold tracking-[-0.018em] text-ink">
              Why this map can be trusted
            </h3>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              Six rules, enforced by the compiler
            </span>
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
            {COMPILER_RULES.map((r) => (
              <div
                key={r.no}
                data-reveal
                data-reveal-group="rules"
                className="group flex flex-col gap-3 border border-transparent bg-hull px-6 pb-7 pt-[26px] transition-[border-color,transform] duration-300 hover:-translate-y-[3px] hover:border-[rgba(143,160,204,.3)]"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-nox">{r.no}</div>
                <div className="text-base font-semibold tracking-[-0.01em] text-ink">{r.title}</div>
                <p className="text-[13.5px] leading-[1.62] text-ink-muted">{r.body}</p>
                <div className="mt-auto pt-2.5 font-mono text-[10.5px] leading-[1.5] tracking-[0.06em] text-ink-dim">
                  {r.fixes}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Column({ title, rows, rule }: { title: string; rows: string[]; rule: string }) {
  return (
    <div className="flex flex-col gap-[11px]">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">{title}</div>
      {rows.map((r) => (
        <div
          key={r}
          className="border-l pl-[13px] text-[13.5px] leading-[1.5] text-[#D6DCEC]"
          style={{ borderColor: rule }}
        >
          {r}
        </div>
      ))}
    </div>
  );
}
