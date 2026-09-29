"use client";

import { useRef } from "react";
import { gsap, useGSAP, useReveal, prefersReducedMotion } from "@/lib/motion";
import { TERMINAL } from "@/lib/content";
import { Accent, Eyebrow } from "./primitives";

const AGENTS = ["Google Antigravity", "Cursor", "Copilot", "Any agent that reads a skill"];

const LINE_COLOR = { cmd: "text-ink", out: "text-ink-muted", dim: "text-ink-faint" } as const;

export default function AgentDownlink() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      // Lines land one after another, the way a real session fills a pane.
      gsap.fromTo(
        "[data-term-line]",
        { opacity: 0, x: -8 },
        {
          opacity: 1,
          x: 0,
          duration: 0.28,
          ease: "power1.out",
          stagger: 0.07,
          scrollTrigger: { trigger: "[data-terminal]", start: "top 78%", once: true },
        },
      );
      gsap.to("[data-caret]", { opacity: 0, duration: 0.01, repeat: -1, yoyo: true, repeatDelay: 0.52 });
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <section id="agents" className="relative w-full overflow-hidden border-b border-hairline py-[72px] sm:py-[100px] lg:py-[118px]">
        <div className="starfield opacity-40" />
        <div className="relative z-[2] mx-auto flex max-w-shell flex-col gap-10 px-5 sm:px-8 lg:flex-row lg:items-start lg:gap-16 lg:px-12">
          <div data-reveal data-reveal-group="agents" className="lg:w-[466px] lg:shrink-0">
            <Eyebrow>06 — Agent downlink</Eyebrow>
            <h2 className="mb-[26px] text-[34px] font-semibold leading-[1.08] tracking-[-0.024em] text-ink sm:text-[42px] lg:text-[50px]">
              Your coding agent gets the <Accent>map</Accent>.
            </h2>
            <p className="mb-[22px] text-base leading-[1.66] text-ink-muted">
              The stage-04 agent does not get a prompt and a repository. It gets the brief, the product
              requirements, the technical spec, and a command it can use to walk the atlas on its own
              &mdash; including into applications it has never been shown.
            </p>
            <p className="mb-[30px] text-base leading-[1.66] text-ink-muted">
              Installed as a skill, so it works wherever your engineers already are.
            </p>
            <div className="flex flex-wrap gap-2">
              {AGENTS.map((a) => (
                <span
                  key={a}
                  className="rounded-sm border border-[rgba(143,160,204,.22)] px-[13px] py-[7px] font-mono text-[11px] tracking-[0.08em] text-ink-muted"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>

          <div
            data-terminal
            data-reveal
            data-reveal-group="agents"
            className="min-w-0 flex-1 overflow-hidden rounded-md border border-[rgba(143,160,204,.18)] bg-hull"
          >
            <div className="flex items-center gap-[9px] border-b border-hairline bg-[rgba(143,160,204,.04)] px-[18px] py-3">
              <span className="block h-[9px] w-[9px] rounded-full bg-[rgba(233,113,60,.6)]" />
              <span className="block h-[9px] w-[9px] rounded-full bg-[rgba(247,181,66,.55)]" />
              <span className="block h-[9px] w-[9px] rounded-full bg-[rgba(95,210,159,.5)]" />
              <span className="ml-2.5 font-mono text-[11px] tracking-[0.08em] text-ink-dim">
                refunds-service — nox skill
              </span>
            </div>

            <div className="flex flex-col gap-5 overflow-x-auto px-6 pb-7 pt-6 font-mono text-[12.5px] leading-[1.85]">
              {TERMINAL.map((block, bi) => (
                <div key={bi} className="flex flex-col">
                  {block.map((l, li) => (
                    <div key={li} data-term-line className="whitespace-pre">
                      {l.kind === "cmd" ? (
                        <>
                          <span className="text-verify">$</span>{" "}
                          <span className="text-ink">{l.text}</span>
                        </>
                      ) : (
                        <span className={LINE_COLOR[l.kind]}>{l.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div data-term-line>
                <span className="text-verify">$</span>{" "}
                <span data-caret className="text-ink">
                  &#9608;
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
