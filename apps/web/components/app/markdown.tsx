"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { openLesson } from "./lessons";
import { MediaChip, parseMediaRef } from "./media/media-chip";

/** OKF frontmatter (the few keys NoX shows): a flat YAML subset, enough for type, title, tags and generated. */
type OkfMeta = { type?: string; okf_version?: string; tags?: string[]; by?: string; at?: string };

function splitFrontmatter(md: string): [OkfMeta | null, string] {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return [null, md];
  const meta: OkfMeta = {};
  let section = "";
  for (const line of m[1].split("\n")) {
    const top = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (top) {
      section = top[1];
      const v = top[2].trim().replace(/^['"]|['"]$/g, "");
      if (section === "type" || section === "okf_version") meta[section] = v;
      if (section === "tags" && v.startsWith("[")) meta.tags = v.slice(1, -1).split(",").map((t) => t.trim()).filter(Boolean);
      continue;
    }
    const nested = /^\s+(?:-\s+)?([a-z_]+):\s*(.*)$/.exec(line);
    if (nested && section === "generated" && (nested[1] === "by" || nested[1] === "at")) meta[nested[1]] = nested[2].trim().replace(/^['"]|['"]$/g, "");
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item && section === "tags") (meta.tags ??= []).push(item[1].trim());
  }
  return [meta, md.slice(m[0].length)];
}

function OkfStrip({ meta }: { meta: OkfMeta }) {
  const when = meta.at ? new Date(meta.at) : null;
  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-hairline bg-[rgb(var(--line)/.05)] px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint"
      title="This page is an Open Knowledge Format document: YAML frontmatter any OKF-aware agent can read"
    >
      <span className="text-[color:var(--role)]">OKF{meta.okf_version ? ` ${meta.okf_version}` : ""}</span>
      {meta.type && <span className="text-ink-muted">{meta.type}</span>}
      {meta.tags?.map((t) => (
        <span key={t} className="rounded-full border border-hairline px-2 py-px normal-case tracking-normal">
          {t}
        </span>
      ))}
      {(meta.by || when) && (
        <span className="normal-case tracking-normal">
          {meta.by && `by ${meta.by}`}
          {when && !Number.isNaN(when.getTime()) && ` · ${when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
        </span>
      )}
    </div>
  );
}

/**
 * KB markdown with wikilinks. `[[page]]` / `[[page|label]]` open a page in the same KB;
 * `[[kb:app/page#anchor|label]]` jump to another application's KB. Pages are Open Knowledge Format documents:
 * the YAML frontmatter shows as a small strip, and OKF's bundle-absolute links (`/entities/x.md`) open in place.
 */
export function KbMarkdown({
  content,
  onOpenPage,
  onOpenCrossKb,
}: {
  content: string;
  onOpenPage?: (path: string) => void;
  onOpenCrossKb?: (app: string, path: string) => void;
}) {
  const [meta, body] = splitFrontmatter(content);
  const source = body
    .replace(/<!--[\s\S]*?-->/g, "")
    // models sometimes group citations as [[kb:a], [kb:b]]: split them into separate wikilinks
    .replace(/\[\[(kb:[^\]]+)\]((?:\s*,\s*\[kb:[^\]]+\])+)\]/g, (_m, first: string, rest: string) =>
      [first, ...[...rest.matchAll(/\[(kb:[^\]]+)\]/g)].map((x) => x[1])].map((t) => `[[${t.trim()}]]`).join(" "),
    )
    // [[media:<id>#t=42]]: a moment in a capture shown to NoX (Show NoX)
    .replace(/\[\[(media:[^\]|]+)\]\]/g, (_m, target: string) => `[media](#nox-media:${encodeURIComponent(target)})`)
    // [[memory:<id>]]: a lesson people taught NoX (team memory); opens the file's lessons list on it
    .replace(/\[\[memory:([0-9a-fA-F-]{36})(?:\|[^\]]*)?\]\]/g, (_m, id: string) => `[lesson](#nox-lesson:${id})`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
      const t = target.trim();
      return `[${(label ?? t.split("/").pop() ?? t).trim()}](#wiki:${encodeURIComponent(t)})`;
    });

  return (
    <div className="kb-prose">
      {meta && (meta.type || meta.okf_version) && <OkfStrip meta={meta} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = "", children }) => {
            if (href.startsWith("#nox-media:")) {
              const ref = parseMediaRef(decodeURIComponent(href.slice(11)));
              return ref ? <MediaChip id={ref.id} t={ref.t} /> : <>{children}</>;
            }
            if (href.startsWith("#nox-lesson:")) {
              const id = href.slice(12);
              return (
                <button type="button" className="lesson-chip" onClick={() => openLesson(id)} title="A rule people taught NoX on an earlier mission">
                  lesson
                </button>
              );
            }
                        if (href.startsWith("#wiki:")) {
              const target = decodeURIComponent(href.slice(6)).split("#")[0];
              const cross = target.startsWith("kb:");
              return (
                <button
                  type="button"
                  className={`wikilink ${cross ? "wikilink-cross" : ""}`}
                  onClick={() => {
                    if (cross) {
                      const [app, ...rest] = target.slice(3).split("/");
                      onOpenCrossKb?.(app, withMd(rest.join("/") || "index"));
                    } else onOpenPage?.(withMd(target));
                  }}
                >
                  {children}
                </button>
              );
            }
            if (/^\/[^\s]+\.md(#.*)?$/.test(href)) {
              return (
                <button type="button" className="wikilink" onClick={() => onOpenPage?.(href.slice(1).split("#")[0])}>
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function withMd(path: string) {
  const p = path.replace(/^\/+/, "");
  return p.endsWith(".md") ? p : `${p}.md`;
}
