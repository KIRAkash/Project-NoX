import Link from "next/link";

import ExperienceLoader from "@/components/experience/experience-loader";
import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";

export default function Page() {
  return (
    <main className="relative w-full">
      <ExperienceLoader />
      {/* the way into the product (and its docs); fixed so it stays reachable through the whole pinned experience */}
      <div className="fixed right-5 top-5 z-[30] flex items-center gap-2 sm:right-8 sm:top-6 lg:right-12 lg:top-7">
        <Link
          href="/docs"
          className="rounded-full px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted transition hover:text-white"
        >
          Docs
        </Link>
        <LiquidMetalLink
          href="/login"
          glow={1}
          className="inline-flex h-12 items-center rounded-full px-7 font-mono text-[12.5px] font-medium uppercase tracking-[0.16em]"
        >
          Enter NoX
        </LiquidMetalLink>
      </div>
    </main>
  );
}
