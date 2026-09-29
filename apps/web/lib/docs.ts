/** The docs: chapters are Markdown files in content/docs, read at build time and rendered at /docs/<slug>. */

import { readFileSync } from "node:fs";
import path from "node:path";

export type Chapter = {
  slug: string;
  file: string;
  title: string;
  /** One line for the index card and the page's meta description. */
  summary: string;
  /** Short label for the sidebar group it belongs to. */
  group: "Start" | "Use NoX" | "How it works";
};

export const CHAPTERS: Chapter[] = [
  { slug: "overview", file: "01-overview.md", group: "Start", title: "What NoX is", summary: "The map, the missions, and why an enterprise change needs both." },
  { slug: "roles", file: "02-roles.md", group: "Start", title: "Roles and seat homes", summary: "The four seats, what each can do, and the home each one gets." },
  { slug: "atlas", file: "03-atlas.md", group: "Use NoX", title: "Atlas", summary: "Organizations and teams, onboarding, living knowledge bases in Google's Open Knowledge Format, pinned corrections, Ask and the contract map." },
  { slug: "missions", file: "04-missions.md", group: "Use NoX", title: "Missions", summary: "Starting a change, the four spec files, writing with NoX, approving, sending back, Jira and Git." },
  { slug: "build-and-verify", file: "05-build-and-verify.md", group: "Use NoX", title: "Build and verify", summary: "The nox CLI, /nox in your coding agent, the PR guard, reverse verification and NoX Local." },
  { slug: "integrations", file: "06-integrations.md", group: "Use NoX", title: "Integrations", summary: "GitHub, Jira, Confluence, Notion, Slack, uploads, Firebase and coding agents: what each does and how to set it up." },
  { slug: "google-ai", file: "07-google-ai.md", group: "How it works", title: "Agentic AI on Google", summary: "The agent team on Google ADK and Gemini, knowledge in Google's Open Knowledge Format, hybrid search with Gemini embeddings, and Gemma for NoX Local." },
  { slug: "architecture", file: "08-architecture.md", group: "How it works", title: "Architecture", summary: "The system, data model, state machine, background work, security, and deploying to Google Cloud." },
  { slug: "roadmap", file: "09-roadmap.md", group: "How it works", title: "Roadmap", summary: "What's next, and how NoX takes enterprise delivery to 10× and 100×." },
];

export const GROUPS: Chapter["group"][] = ["Start", "Use NoX", "How it works"];

export function chapter(slug: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.slug === slug);
}

export function readChapter(c: Chapter): string {
  return readFileSync(path.join(process.cwd(), "content", "docs", c.file), "utf8");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The chapter's `##` headings, for the "On this page" list. */
export function headings(markdown: string): { id: string; text: string }[] {
  let inFence = false;
  const out: { id: string; text: string }[] = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      const text = line.slice(3).replace(/[`*]/g, "").trim();
      out.push({ id: slugify(text), text });
    }
  }
  return out;
}
