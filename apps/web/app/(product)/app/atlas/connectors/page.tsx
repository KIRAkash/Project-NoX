"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";

import { BrandLogo, BRANDS, isBrand } from "@/components/app/brand-logo";
import { PageHeader, Panel } from "@/components/app/ui";
import { useApi } from "@/lib/app/use-api";

type Integration = { name: string; required: boolean; configured: boolean; ok: boolean; detail: string };

const ABOUT: Record<string, string> = {
  github: "Reads source repositories; creates kb- repositories and pull requests through the GitHub App.",
  jira: "Reads project issues into knowledge bases; creates and moves mission tickets.",
  confluence: "Reads spaces and pages into knowledge bases.",
  notion: "Reads pages shared with the NoX integration.",
  slack: "Reads channel history into knowledge bases.",
  gemini: "Compiles the code wiki, drafts spec files and answers questions.",
  ollama: "Local Gemma model, used in local and hybrid AI modes.",
  jules: "Google's coding agent. The developer can hand a mission in Build to Jules, approve its plan, and get its pull request back on the mission.",
};

/** How to connect a connector that isn't set up yet (only where the steps aren't obvious). */
const SETUP: Record<string, string[]> = {
  jules: [
    "Create an API key at jules.google.com → Settings → API.",
    "Install the Jules GitHub app on your applications' repositories, from the Jules web app.",
    "Store the key as JULES_API_KEY (Secret Manager in the cloud), then check again.",
  ],
};

const TITLE: Record<string, string> = { jules: "Jules" };

export default function ConnectorsPage() {
  const status = useApi<{ ok: boolean; integrations: Integration[] }>("/api/v1/integrations/status");
  return (
    <div className="mx-auto max-w-shell">
      <Link href="/app/atlas" className="text-[13px] text-ink-dim hover:text-ink">
        ← Atlas
      </Link>
      <div className="mt-4">
        <PageHeader
          eyebrow="Connectors"
          title="Ground stations"
          lead="Every system NoX reads from or writes to, checked live against the credentials this deployment is configured with."
          action={
            <button type="button" onClick={() => void status.reload()} disabled={status.loading} className="inline-flex h-10 items-center gap-2 rounded-sm border border-hairline px-4 text-[13px] text-ink-muted hover:text-ink disabled:opacity-50">
              <RefreshCw size={14} className={status.loading ? "animate-spin" : ""} /> Check again
            </button>
          }
        />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {(status.data?.integrations ?? []).map((i) => (
          <Panel key={i.name} title={isBrand(i.name) ? BRANDS[i.name] : TITLE[i.name] ?? i.name}>
            <div className="flex items-start gap-3">
              {isBrand(i.name) && (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-hairline bg-[rgba(143,160,204,.06)]">
                  <BrandLogo name={i.name} size={22} />
                </span>
              )}
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[14px] text-ink">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: !i.configured ? "#6E7793" : i.ok ? "#5FD29F" : "#E9713C" }} />
                  {!i.configured ? "Not configured" : i.ok ? "Connected" : "Failing"}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-faint">{i.detail}</p>
                <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">{ABOUT[i.name]}</p>
                {i.required && !i.ok && <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#F3A27E]">Needed for the demo</p>}
                {!i.ok && SETUP[i.name] && (
                  <ol className="mt-3 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-ink-faint">
                    {SETUP[i.name].map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </Panel>
        ))}
        {status.loading && !status.data && <p className="text-[13px] text-ink-faint">Checking every connector…</p>}
      </div>
      <p className="mt-6 text-[12.5px] text-ink-faint">Credentials come from the deployment&rsquo;s environment for now; per-organization credentials come later.</p>
    </div>
  );
}
