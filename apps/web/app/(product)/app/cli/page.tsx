"use client";

import { BrandLogo, BRANDS } from "@/components/app/brand-logo";
import { EmptyState, PageHeader, Panel, useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import { useApi } from "@/lib/app/use-api";

type Token = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

const STEPS: { cmd: string; note: string }[] = [
  { cmd: "packages/nox-cli/install.sh", note: "Puts `nox` on your PATH. Node 18, no other dependencies." },
  { cmd: "nox login", note: "Device flow: approve the code in this browser and the CLI gets a personal token." },
  { cmd: "nox init antigravity", note: "Installs /nox for your agent. Also cursor, codex, copilot, claude, or all." },
  { cmd: "/nox NOX-12", note: "In your agent: loads the mission, the four spec files and the knowledge base, then builds." },
];

/** The coding agents `nox init` can install /nox for. */
const AGENTS = ["antigravity", "cursor", "codex", "copilot", "claude"] as const;

const COMMANDS: [string, string][] = [
  ["nox missions --view waiting", "What's waiting on you"],
  ["nox context NOX-12 --save", "The whole mission for an agent"],
  ["nox search <words>", "Search every knowledge base you can see"],
  ["nox pr NOX-12", "Link a pull request and run the guard"],
  ["nox complete NOX-12", "Mark it built and open verification"],
  ["nox kb build", "Build a knowledge base locally with Gemma"],
];

/** The developer's terminal setup: how to connect the CLI, and the tokens it has signed in with. */
export default function CliPage() {
  const toast = useToast();
  const tokens = useApi<Token[]>("/api/v1/me/tokens");

  const revoke = async (t: Token) => {
    try {
      await api(`/api/v1/me/tokens/${t.id}`, { method: "DELETE" });
      toast(`Revoked ${t.name}`, "success");
      void tokens.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't revoke the token", "error");
    }
  };

  return (
    <div className="mx-auto max-w-shell">
      <PageHeader eyebrow="CLI" title="nox, in your terminal" lead="Build missions with the coding agent you already use. The CLI brings the spec files and the knowledge base to it." />

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        <Panel title="Get set up" className="lg:col-span-2">
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.cmd} className="flex gap-3">
                <span className="mt-1 font-mono text-[11px] text-ink-dim">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <code className="block overflow-x-auto rounded-sm border border-hairline bg-[#04050A] px-3 py-2 font-mono text-[13px] text-[#CFE3FA]">
                    {i === STEPS.length - 1 ? "> " : "$ "}
                    {s.cmd}
                  </code>
                  <p className="mt-1.5 text-[12.5px] text-ink-faint">{s.note}</p>
                  {s.cmd.startsWith("nox init") && (
                    <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Supported coding agents">
                      {AGENTS.map((a) => (
                        <li key={a} className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-[rgba(143,160,204,.06)] px-2 py-1 text-[12px] text-ink-muted">
                          <BrandLogo name={a} size={14} />
                          {BRANDS[a]}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Signed-in tokens">
          {tokens.loading && !tokens.data ? (
            <p className="font-mono text-[13px] text-ink-faint">loading…</p>
          ) : tokens.data?.length ? (
            <ul className="space-y-3">
              {tokens.data.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-ink">{t.name}</span>
                    <span className="block text-[11.5px] text-ink-faint">{t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleString()}` : "Never used"}</span>
                  </span>
                  <button type="button" onClick={() => void revoke(t)} className="shrink-0 text-[12px] text-ink-dim hover:text-[#E9713C]">
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState line="The CLI hasn't signed in yet. Run `nox login` to connect it." />
          )}
        </Panel>
      </div>

      <Panel title="Everyday commands" className="mt-5">
        <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {COMMANDS.map(([cmd, what]) => (
            <li key={cmd} className="flex min-w-0 flex-col text-[13px]">
              <code className="truncate font-mono text-[#CFE3FA]">$ {cmd}</code>
              <span className="text-[12px] text-ink-faint">{what}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
