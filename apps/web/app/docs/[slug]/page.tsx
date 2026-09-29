import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocMarkdown } from "@/components/docs/doc-markdown";
import { CHAPTERS, chapter, headings, readChapter } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = chapter((await params).slug);
  return c ? { title: c.title, description: c.summary } : {};
}

export default async function ChapterPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = chapter((await params).slug);
  if (!c) notFound();
  const source = readChapter(c);
  const toc = headings(source);
  const i = CHAPTERS.indexOf(c);
  const prev = CHAPTERS[i - 1];
  const next = CHAPTERS[i + 1];

  return (
    <div className="flex items-start gap-12">
      <article className="min-w-0 max-w-[780px] flex-1">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-nox">
          {String(i + 1).padStart(2, "0")} · {c.group}
        </p>
        <DocMarkdown source={source} />

        <nav aria-label="More chapters" className="mt-16 grid gap-3 border-t border-hairline pt-8 sm:grid-cols-2">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className="group rounded-md border border-hairline p-4 transition-colors hover:border-[rgba(247,181,66,.45)]">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">
                <ArrowLeft size={12} /> Previous
              </span>
              <span className="mt-1 block text-[15px] text-ink group-hover:text-nox">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/docs/${next.slug}`} className="group rounded-md border border-hairline p-4 text-right transition-colors hover:border-[rgba(247,181,66,.45)]">
              <span className="flex items-center justify-end gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">
                Next <ArrowRight size={12} />
              </span>
              <span className="mt-1 block text-[15px] text-ink group-hover:text-nox">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>

      {toc.length > 1 && (
        <aside className="sticky top-20 hidden w-[220px] shrink-0 xl:block" aria-label="On this page">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-dim">On this page</p>
          <ul className="mt-3 space-y-1.5 border-l border-hairline">
            {toc.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`} className="-ml-px block border-l border-transparent py-0.5 pl-3 text-[13px] leading-snug text-ink-faint hover:border-nox hover:text-ink">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
