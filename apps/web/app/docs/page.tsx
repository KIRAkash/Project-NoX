import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";
import { CHAPTERS, GROUPS } from "@/lib/docs";

export const metadata: Metadata = { title: { absolute: "NoX docs" } };

const SEATS = [
  { name: "Business user", hue: "#E8C97A", line: "Asks in one sentence. Confirms at the end that it came true." },
  { name: "Product owner", hue: "#A897F0", line: "Turns it into acceptance criteria, edge cases and a metric." },
  { name: "Engineering lead", hue: "#5FCBD8", line: "Decides which applications change and what must not break." },
  { name: "Developer", hue: "#86B9EE", line: "Builds it with /nox in their own coding agent." },
];

const STACK = [
  { name: "Google ADK", what: "Every agent, its tools, sessions and streaming" },
  { name: "Gemini", what: "Fast, default and deep tiers with automatic fallback" },
  { name: "Gemini Enterprise Agent Platform", what: "Model access by service account, no API keys deployed" },
  { name: "Open Knowledge Format", what: "Google Cloud's open standard: every knowledge base is an OKF bundle any agent can read" },
  { name: "gemini-embedding-2", what: "Hybrid search over every knowledge base, with pgvector" },
  { name: "Gemma", what: "NoX Local: knowledge bases built on the developer's machine" },
  { name: "Google Cloud", what: "Cloud Run, Cloud SQL, Memorystore, Cloud Storage, Secret Manager" },
  { name: "Firebase Authentication", what: "Google sign-in, verified on every request" },
];

export default function DocsHome() {
  return (
    <div className="max-w-[1000px]">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-nox">NoX documentation</p>
      <h1 className="mt-3 font-display text-[44px] leading-[1.05] text-ink sm:text-[60px]">
        From one sentence to <span className="italic text-nox">verified</span> software
      </h1>
      <p className="mt-5 max-w-[680px] text-[16.5px] leading-relaxed text-ink-muted">
        NoX keeps a live map of every application an enterprise runs, then carries each change through the four people who shape it, with a team of AI
        agents doing the reading, drafting and checking in between. These docs walk through every feature, and how it is built on Google&rsquo;s agent
        stack.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <LiquidMetalLink href="/docs/overview" className="inline-flex h-11 items-center gap-2 rounded-sm px-5 text-[14px] font-semibold">
          Start reading <ArrowRight size={16} />
        </LiquidMetalLink>
        <Link href="/docs/google-ai" className="inline-flex h-11 items-center gap-2 rounded-sm border border-hairline px-5 text-[14px] text-ink hover:border-ink-faint">
          How the agents work
        </Link>
      </div>

      <section aria-label="The four seats" className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SEATS.map((s, i) => (
          <div key={s.name} className="rounded-md border border-hairline bg-[#0b0e19] p-4">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="h-5 w-5 rounded-full"
                style={{ background: `radial-gradient(circle at 32% 30%, color-mix(in srgb, ${s.hue} 35%, #fff), ${s.hue} 45%, color-mix(in srgb, ${s.hue} 45%, #05060B))` }}
              />
              <span className="font-mono text-[10.5px] text-ink-dim">0{i + 1}</span>
            </div>
            <p className="mt-3 text-[14.5px] font-semibold text-ink">{s.name}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">{s.line}</p>
          </div>
        ))}
      </section>

      {GROUPS.map((g) => (
        <section key={g} aria-label={g} className="mt-14">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">{g}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {CHAPTERS.filter((c) => c.group === g).map((c) => (
              <Link
                key={c.slug}
                href={`/docs/${c.slug}`}
                className="group flex flex-col justify-between gap-4 rounded-md border border-[rgba(143,160,204,.18)] bg-[rgba(236,239,248,.02)] p-5 transition-colors hover:border-[rgba(247,181,66,.45)]"
              >
                <div>
                  <span className="font-mono text-[11px] text-ink-dim">{String(CHAPTERS.indexOf(c) + 1).padStart(2, "0")}</span>
                  <p className="mt-1 font-display text-[24px] leading-tight text-ink group-hover:text-nox">{c.title}</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-faint">{c.summary}</p>
                </div>
                <ArrowRight size={14} aria-hidden className="text-ink-dim group-hover:text-ink" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section aria-label="Built on Google" className="mt-16 border-t border-hairline pt-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-dim">Built on</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {STACK.map((s) => (
            <div key={s.name}>
              <dt className="text-[14px] font-semibold text-ink">{s.name}</dt>
              <dd className="mt-0.5 text-[13px] text-ink-faint">{s.what}</dd>
            </div>
          ))}
        </dl>
        <Link href="/docs/google-ai" className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-[#8FC4F2] hover:underline">
          Agentic AI on Google <ArrowRight size={13} />
        </Link>
      </section>
    </div>
  );
}
