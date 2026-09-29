"use client";

import { useRef } from "react";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/motion";
import { Accent, Check, GhostLink, PrimaryLink } from "./primitives";
import OrbitalSystem from "./orbital-system";

const PROOF = [
  "Living code wikis, per application",
  "Cross-application contract mesh",
  "Requirement traced to the commit",
  "Jira and Confluence stay in sync",
];

export default function Hero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) {
        gsap.set("[data-hero]", { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        "[data-hero]",
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.12, delay: 0.1 },
      );
    },
    { scope: root },
  );

  return (
    <section
      id="top"
      ref={root}
      className="relative w-full overflow-hidden border-b border-hairline pt-[120px] lg:min-h-[940px] lg:pt-[96px]"
    >
      <div className="starfield" />
      <div className="starfield starfield--far" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-36 h-[900px] w-[900px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(247,181,66,.10) 0%, rgba(233,113,60,.05) 34%, rgba(5,6,11,0) 66%)",
        }}
      />

      <div className="relative z-[2] mx-auto flex max-w-shell flex-col gap-10 px-5 sm:px-8 lg:flex-row lg:items-start lg:gap-10 lg:px-12">
        <div className="lg:w-[560px] lg:shrink-0 lg:pt-11">
          <div data-hero className="mb-[30px] flex items-center gap-3">
            <span className="block h-px w-[22px] bg-[rgba(247,181,66,.7)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">
              Spec-driven orchestration for the age of AI
            </span>
          </div>

          <h1
            data-hero
            className="text-[44px] font-semibold leading-[1.02] tracking-[-0.028em] text-ink sm:text-[60px] lg:text-[76px] [text-wrap:balance]"
          >
            From a <Accent>sentence</Accent>
            <br className="hidden sm:block" /> to shipped software.
          </h1>

          <p
            data-hero
            className="mt-[30px] max-w-[508px] text-base leading-[1.62] text-ink-muted lg:text-[17.5px] [text-wrap:pretty]"
          >
            In the age of AI, generating code is easy; preserving enterprise architecture is not. NoX orchestrates a spec-driven development process across a living map of your estate—carrying every change through product, architecture, implementation and reverse verification with unbroken context.
          </p>

          <div data-hero className="mt-10 flex flex-wrap items-center gap-[14px]">
            <PrimaryLink href="#access">Request access</PrimaryLink>
            <GhostLink href="#lifecycle">Follow a change</GhostLink>
          </div>

          <div
            data-hero
            className="mt-12 grid grid-cols-1 gap-[18px_28px] border-t border-hairline pt-[22px] sm:grid-cols-2 lg:mt-[66px]"
          >
            {PROOF.map((p) => (
              <div key={p} className="flex items-start gap-[10px]">
                <Check className="mt-[3px] shrink-0" />
                <span className="font-mono text-[11px] uppercase leading-[1.55] tracking-[0.09em] text-ink-faint">
                  {p}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div data-hero className="min-w-0 flex-1 lg:-mr-[180px] lg:-mt-9">
          <OrbitalSystem />
        </div>
      </div>
    </section>
  );
}
