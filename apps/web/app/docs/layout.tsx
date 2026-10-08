import type { Metadata } from "next";
import Link from "next/link";

import { NoxMark } from "@/components/app/nox-mark";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { DocsNav } from "@/components/docs/docs-nav";
import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";
import { CHAPTERS, GROUPS } from "@/lib/docs";

export const metadata: Metadata = {
  title: { default: "NoX docs", template: "%s · NoX docs" },
  description: "How NoX works: the Atlas, missions, the four seats, integrations, and the agent team built on Google ADK, Gemini and Gemma.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-void">
      <div className="starfield starfield--far pointer-events-none fixed inset-0 opacity-50" aria-hidden />
      <header className="sticky top-0 z-30 border-b border-hairline bg-[rgb(var(--void-rgb)/.82)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="NoX home">
              <NoxMark size={20} />
            </Link>
            <span className="h-4 w-px bg-hairline" aria-hidden />
            <Link href="/docs" className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted hover:text-ink">
              Docs
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle size="sm" />
            <LiquidMetalLink
              href="/login"
              className="rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em]"
            >
              Enter NoX
            </LiquidMetalLink>
          </div>
        </div>
      </header>
      {/* Phones: the chapter menu sits above the page. Wide screens: a sticky sidebar beside it. */}
      <div className="relative mx-auto flex max-w-[1320px] flex-col px-4 pb-24 pt-6 sm:px-6 lg:flex-row lg:items-start lg:gap-10 lg:pt-12">
        <DocsNav chapters={CHAPTERS.map(({ slug, title, group }) => ({ slug, title, group }))} groups={GROUPS} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
