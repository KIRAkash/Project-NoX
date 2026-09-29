"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import type { Chapter } from "@/lib/docs";

type Props = { chapters: Pick<Chapter, "slug" | "title" | "group">[]; groups: Chapter["group"][] };

function List({ chapters, groups, current }: Props & { current: string }) {
  return (
    <nav aria-label="Docs chapters" className="space-y-6">
      <Link
        href="/docs"
        aria-current={current === "" ? "page" : undefined}
        className={`block rounded-sm px-3 py-1.5 text-[13.5px] ${current === "" ? "bg-[rgba(247,181,66,.1)] text-ink" : "text-ink-muted hover:text-ink"}`}
      >
        Docs home
      </Link>
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-dim">{g}</p>
          <ul className="mt-2 space-y-0.5">
            {chapters
              .filter((c) => c.group === g)
              .map((c) => {
                const on = current === c.slug;
                return (
                  <li key={c.slug}>
                    <Link
                      href={`/docs/${c.slug}`}
                      aria-current={on ? "page" : undefined}
                      className={`relative block rounded-sm px-3 py-1.5 text-[13.5px] transition-colors ${on ? "bg-[rgba(247,181,66,.1)] text-ink" : "text-ink-muted hover:bg-[rgba(236,239,248,.03)] hover:text-ink"}`}
                    >
                      {on && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-nox" />}
                      {c.title}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Chapter list: a sticky sidebar on wide screens, a collapsible menu on phones. */
export function DocsNav(props: Props) {
  const pathname = usePathname();
  const current = pathname.replace(/^\/docs\/?/, "").split("/")[0] ?? "";
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (menu.current) menu.current.open = false; // close the phone menu after navigating
  }, [pathname]);
  const title = props.chapters.find((c) => c.slug === current)?.title ?? "Docs home";

  return (
    <>
      <details ref={menu} className="group mb-6 rounded-md border border-hairline bg-deck lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] text-ink [&::-webkit-details-marker]:hidden">
          <span>
            <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">Chapter</span>
            {title}
          </span>
          <ChevronDown size={16} className="text-ink-dim transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-hairline px-1 py-4">
          <List {...props} current={current} />
        </div>
      </details>
      <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-[232px] shrink-0 overflow-y-auto pb-10 lg:block">
        <List {...props} current={current} />
      </aside>
    </>
  );
}
