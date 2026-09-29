"use client";

import { useRef } from "react";
import { gsap, useGSAP, useJsReady, useScrollTriggerRefresh } from "@/lib/motion";
import { NoxMark } from "./primitives";

const LINKS = [
  { href: "#atlas", label: "Atlas" },
  { href: "#lifecycle", label: "Lifecycle" },
  { href: "#verify", label: "Verification" },
  { href: "#agents", label: "Agents" },
];

export default function Nav() {
  const root = useRef<HTMLElement>(null);
  useJsReady();
  useScrollTriggerRefresh();

  // The bar starts transparent over the hero and gains its rule and blur once
  // the page has moved, so the hero reads as one uninterrupted field.
  useGSAP(
    () => {
      gsap.to(root.current, {
        backgroundColor: "rgba(5,6,11,0.88)",
        borderBottomColor: "rgba(143,160,204,0.14)",
        backdropFilter: "blur(14px)",
        duration: 0.4,
        ease: "power2.out",
        scrollTrigger: { start: 80, end: 99999, toggleActions: "play none none reverse" },
      });
    },
    { scope: root },
  );

  return (
    <header
      ref={root}
      className="fixed inset-x-0 top-0 z-[60] w-full border-b border-transparent"
    >
      <nav className="mx-auto flex max-w-shell items-center gap-6 px-5 py-4 sm:px-8 lg:gap-10 lg:px-12 lg:py-[18px]">
        <a href="#top" className="flex min-h-[44px] items-center gap-[11px]">
          <NoxMark />
          <span className="font-display text-[23px] tracking-[0.01em] text-ink">NoX</span>
        </a>

        <div className="hidden flex-1 items-center gap-[30px] md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="inline-flex min-h-[44px] items-center text-[13.5px] tracking-[0.01em] text-ink-muted transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </div>

        <a
          href="#access"
          className="ml-auto inline-flex h-11 items-center rounded-sm bg-nox px-[18px] font-mono text-[11.5px] font-medium uppercase tracking-[0.1em] text-[#120D04] transition-colors hover:bg-[#FFC861] md:ml-0"
        >
          Request access
        </a>
      </nav>
    </header>
  );
}
