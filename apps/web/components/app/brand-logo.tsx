import { Upload } from "lucide-react";

import type { SourceType } from "@/lib/app/types";

/**
 * Real brand marks for the systems NoX talks to. The SVGs live in `public/logos/` and come from svgl.app
 * (dark-theme variants; the white-only ones are inverted on the light theme). svgl has no Jira or Confluence mark, so those
 * two are the Simple Icons glyphs filled with Atlassian blue.
 */
export const BRANDS = {
  github: "GitHub",
  jira: "Jira",
  confluence: "Confluence",
  notion: "Notion",
  slack: "Slack",
  gemini: "Gemini",
  ollama: "Ollama",
  "google-cloud": "Google Cloud",
  firebase: "Firebase",
  antigravity: "Google Antigravity",
  cursor: "Cursor",
  codex: "Codex",
  copilot: "GitHub Copilot",
  claude: "Claude Code",
  atlassian: "Atlassian",
  postgresql: "PostgreSQL",
} as const;

export type Brand = keyof typeof BRANDS;

/** Marks drawn in white only. On the light theme they are inverted to ink (see `.brand-mono` in globals.css). */
const MONO = new Set<Brand>(["github", "codex", "copilot", "cursor", "ollama", "postgresql"]);

export function isBrand(name: string): name is Brand {
  return name in BRANDS;
}

export function BrandLogo({ name, size = 16, className = "", title }: { name: Brand | "upload"; size?: number; className?: string; title?: string }) {
  if (name === "upload") return <Upload size={size} className={`shrink-0 text-ink-muted ${className}`} aria-label={title ?? "File upload"} />;
  const label = title ?? BRANDS[name];
  return (
    // Plain <img>: these are tiny static SVGs, next/image adds nothing here.
    <img src={`/logos/${name}.svg`} alt={label} title={label} width={size} height={size} className={`shrink-0 object-contain ${MONO.has(name) ? "brand-mono" : ""} ${className}`} style={{ width: size, height: size }} />
  );
}

/** A source type's display name (the upload type has no brand). */
export function sourceLabel(type: SourceType) {
  return type === "upload" ? "Upload" : BRANDS[type];
}

/** One chip per distinct source type, in a fixed order, so every card reads the same way. */
const ORDER: SourceType[] = ["github", "confluence", "jira", "notion", "slack", "upload"];

export function SourceLogos({ types, size = 14, className = "" }: { types: SourceType[]; size?: number; className?: string }) {
  const counts = new Map<SourceType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  const present = ORDER.filter((t) => counts.has(t));
  if (!present.length) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {present.map((t) => {
        const n = counts.get(t)!;
        const label = `${n} ${sourceLabel(t)} source${n === 1 ? "" : "s"}`;
        return (
          <span key={t} title={label} aria-label={label} className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-[rgb(var(--line)/.06)] px-1.5 py-1">
            <BrandLogo name={t} size={size} title={label} />
            {n > 1 && <span className="font-mono text-[10px] leading-none text-ink-faint">{n}</span>}
          </span>
        );
      })}
    </span>
  );
}
