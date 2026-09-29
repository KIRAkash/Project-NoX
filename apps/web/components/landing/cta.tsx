"use client";

import { useRef } from "react";
import { useReveal } from "@/lib/motion";
import { Accent, NoxMark } from "./primitives";

export default function Cta() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  return (
    <div ref={root}>
      <section id="access" className="relative w-full overflow-hidden py-[84px] sm:py-[110px] lg:pb-[124px] lg:pt-[132px]">
        <div className="starfield starfield--far" />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-[520px] left-1/2 h-[1200px] w-[1200px] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(247,181,66,.13) 0%, rgba(233,113,60,.06) 36%, rgba(5,6,11,0) 64%)",
          }}
        />

        <div className="relative z-[2] mx-auto flex max-w-shell flex-col items-center gap-[30px] px-5 sm:px-8 lg:px-12">
          <NoxMark size={40} spin />

          <h2
            data-reveal
            data-reveal-group="cta"
            className="max-w-[880px] text-center text-[36px] font-semibold leading-[1.08] tracking-[-0.026em] text-ink sm:text-[46px] lg:text-[56px] [text-wrap:balance]"
          >
            Point NoX at one repository.
            <br className="hidden sm:block" /> Watch it draw the <Accent>rest</Accent>.
          </h2>

          <p
            data-reveal
            data-reveal-group="cta"
            className="max-w-[600px] text-center text-[16.5px] leading-[1.65] text-ink-muted"
          >
            NoX is in private beta with a small number of engineering organisations. Tell us about your
            estate and we will map one application with you.
          </p>

          <form
            data-reveal
            data-reveal-group="cta"
            className="mt-3 flex w-full max-w-[460px] flex-col items-stretch gap-2.5 sm:flex-row sm:items-end"
          >
            <div className="flex flex-1 flex-col gap-2">
              <label
                htmlFor="work-email"
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint"
              >
                Work email
              </label>
              <input
                id="work-email"
                name="work-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="h-12 rounded-sm border border-[rgba(143,160,204,.24)] bg-[rgba(143,160,204,.05)] px-4 text-[14.5px] text-ink placeholder:text-[#6A7492] focus:border-nox focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="h-12 shrink-0 rounded-sm bg-nox px-[26px] font-mono text-xs font-medium uppercase tracking-[0.1em] text-[#120D04] transition-[background,box-shadow] duration-300 hover:bg-[#FFC861] hover:shadow-[0_16px_48px_-20px_rgba(247,181,66,0.85)]"
            >
              Request access
            </button>
          </form>

          <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
            Self-hosted and air-gapped deployments available
          </p>
        </div>
      </section>
    </div>
  );
}
