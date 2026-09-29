"use client";

import { Check, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/app/brand-logo";
import { PageHeader, Panel, useToast } from "@/components/app/ui";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, API_URL, ApiError, authHeaders } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID } from "@/lib/app/roles";
import { SOURCE_LABEL, SOURCE_PLACEHOLDER, type Kb, type Org, type SourceType } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

type Check = { state: "idle" | "checking" | "ok" | "fail"; detail?: string };
type Row = { key: number; type: SourceType; url: string; check: Check; fileName?: string };

const TYPES: SourceType[] = ["github", "confluence", "jira", "notion", "slack", "upload"];
let nextKey = 1;

export default function OnboardPage() {
  const { me } = useAuth();
  const role = ROLE_BY_ID[me!.role!];
  const router = useRouter();
  const toast = useToast();
  const orgs = useApi<Org[]>("/api/v1/orgs");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: nextKey++, type: "github", url: "", check: { state: "idle" } }]);
  const [launching, setLaunching] = useState(false);

  const orgOptions = useMemo(() => flatten(orgs.data ?? []), [orgs.data]);
  const chosenOrg = orgId || orgOptions[0]?.id || "";

  // "Onboard into <team>" on the atlas links here with ?org=<id>.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("org");
    if (preset) setOrgId(preset);
  }, []);

  if (!me!.capabilities.includes("onboard_app")) {
    return <p className="text-ink-faint">This seat can&rsquo;t onboard applications.</p>;
  }

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const validate = async (row: Row) => {
    if (!row.url.trim()) return;
    update(row.key, { check: { state: "checking" } });
    try {
      const res = await api<{ ok: boolean; detail: string }>("/api/v1/sources/validate", { method: "POST", json: { type: row.type, url: row.url } });
      update(row.key, { check: { state: res.ok ? "ok" : "fail", detail: res.detail } });
    } catch (e) {
      update(row.key, { check: { state: "fail", detail: e instanceof ApiError ? e.detail : "Couldn't check" } });
    }
  };

  const upload = async (row: Row, file: File) => {
    update(row.key, { check: { state: "checking" }, fileName: file.name });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API_URL}/api/v1/upload/file`, { method: "POST", headers: await authHeaders(), body: form });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { storage_path: string };
      update(row.key, { url: body.storage_path, check: { state: "ok", detail: `${file.name} uploaded` } });
    } catch {
      update(row.key, { check: { state: "fail", detail: "Upload failed" } });
    }
  };

  const filled = rows.filter((r) => r.url.trim());
  const allValid = filled.length > 0 && filled.every((r) => r.check.state === "ok");

  const launch = async () => {
    setLaunching(true);
    try {
      const kb = await api<Kb>(`/api/v1/orgs/${chosenOrg}/apps`, {
        method: "POST",
        json: { appName: name.trim(), sourceUrls: filled.map((r) => ({ type: r.type, url: r.url.trim() })) },
      });
      toast(`${kb.appName} launched — building its knowledge base`, "success");
      router.push(`/app/atlas/apps/${kb.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't launch", "error");
      setLaunching(false);
    }
  };

  const steps = ["Basics", "Sources", "Launch"];

  return (
    <div className="mx-auto max-w-[820px]">
      <Link href="/app/atlas" className="text-[13px] text-ink-dim hover:text-ink">
        ← Atlas
      </Link>
      <div className="mt-4">
        <PageHeader eyebrow="Onboard application" title="Chart a new planet" lead="Name it, point NoX at its sources, and launch. NoX reads everything, writes the code wiki, and opens it as a pull request." />
      </div>

      <ol className="mt-8 flex gap-2" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full border text-[11px]"
              style={{ borderColor: i <= step ? role.hue : "rgba(143,160,204,.25)", color: i <= step ? role.hue : "#6E7793" }}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step ? <Check size={12} /> : i + 1}
            </span>
            <span className={`text-[13px] ${i === step ? "text-ink" : "text-ink-dim"}`}>{s}</span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-hairline" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Panel title="Basics" className="mt-6">
          <div className="space-y-5">
            <Field label="Application name" hint="As your teams call it, e.g. order-matching-engine">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
            </Field>
            <Field label="Belongs to" hint="The organization or team that owns it">
              {orgOptions.length ? (
                <select value={chosenOrg} onChange={(e) => setOrgId(e.target.value)} className={inputCls}>
                  {orgOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {"— ".repeat(o.depth)}
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[13px] text-ink-faint">You need an organization first — an engineering lead can create one in the atlas.</p>
              )}
            </Field>
          </div>
          <Footer>
            <LiquidMetalButton hue={role.hue} disabled={name.trim().length < 2 || !chosenOrg} onClick={() => setStep(1)} className={primaryCls}>
              Next: sources
            </LiquidMetalButton>
          </Footer>
        </Panel>
      )}

      {step === 1 && (
        <Panel title="Sources" className="mt-6">
          <p className="mb-4 text-[13px] text-ink-muted">Add the code and every place its knowledge lives. NoX checks each one with the connected credentials before you launch.</p>
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.key} className="rounded-sm border border-hairline p-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative sm:w-[190px]">
                    <BrandLogo name={row.type} size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                    <select
                      value={row.type}
                      aria-label="Source type"
                      onChange={(e) => update(row.key, { type: e.target.value as SourceType, url: "", check: { state: "idle" }, fileName: undefined })}
                      className={`${inputCls} w-full pl-9`}
                    >
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {SOURCE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {row.type === "upload" ? (
                    <label className={`${inputCls} flex flex-1 cursor-pointer items-center gap-2 text-ink-muted`}>
                      <Upload size={14} />
                      {row.fileName ?? "Choose a file (OpenAPI, AsyncAPI, docs…)"}
                      <input type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(row, e.target.files[0])} />
                    </label>
                  ) : (
                    <input
                      value={row.url}
                      aria-label={`${SOURCE_LABEL[row.type]} URL`}
                      placeholder={SOURCE_PLACEHOLDER[row.type]}
                      onChange={(e) => update(row.key, { url: e.target.value, check: { state: "idle" } })}
                      onBlur={() => void validate(row)}
                      className={`${inputCls} flex-1`}
                    />
                  )}
                  <button type="button" aria-label="Remove source" onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))} className="flex h-10 w-10 items-center justify-center text-ink-dim hover:text-ink">
                    <Trash2 size={15} />
                  </button>
                </div>
                <CheckLine check={row.check} onRetry={() => void validate(row)} />
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setRows((rs) => [...rs, { key: nextKey++, type: "confluence", url: "", check: { state: "idle" } }])} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
            <Plus size={14} /> Add another source
          </button>
          <Footer>
            <button type="button" onClick={() => setStep(0)} className={secondaryCls}>
              Back
            </button>
            <LiquidMetalButton hue={role.hue} disabled={!allValid} onClick={() => setStep(2)} className={primaryCls}>
              Next: review
            </LiquidMetalButton>
          </Footer>
        </Panel>
      )}

      {step === 2 && (
        <Panel title="Review and launch" className="mt-6">
          <dl className="grid gap-4 text-[14px] sm:grid-cols-[160px_1fr]">
            <dt className="text-ink-dim">Application</dt>
            <dd className="text-ink">{name}</dd>
            <dt className="text-ink-dim">Belongs to</dt>
            <dd className="text-ink">{orgOptions.find((o) => o.id === chosenOrg)?.name}</dd>
            <dt className="text-ink-dim">Sources</dt>
            <dd>
              <ul className="space-y-1">
                {filled.map((r) => (
                  <li key={r.key} className="flex items-center gap-2 text-ink-muted">
                    <BrandLogo name={r.type} size={14} />
                    <span className="min-w-0">
                      <span className="text-ink">{SOURCE_LABEL[r.type]}</span> · {r.check.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
          <p className="mt-6 rounded-sm border border-hairline bg-[rgba(143,160,204,.04)] p-3 text-[13px] text-ink-muted">
            NoX will read every source, compile the code wiki, and open it as a pull request on a new <span className="font-mono">kb-</span> repository. Review and merge it to put the application in orbit.
          </p>
          <Footer>
            <button type="button" onClick={() => setStep(1)} className={secondaryCls}>
              Back
            </button>
            <LiquidMetalButton hue={role.hue} disabled={launching} onClick={() => void launch()} className={primaryCls}>
              {launching ? "Launching…" : "Launch"}
            </LiquidMetalButton>
          </Footer>
        </Panel>
      )}
    </div>
  );
}

function flatten(orgs: Org[]): (Org & { depth: number })[] {
  const byParent = new Map<string | null, Org[]>();
  const ids = new Set(orgs.map((o) => o.id));
  for (const o of orgs) {
    const p = o.parentOrgId && ids.has(o.parentOrgId) ? o.parentOrgId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), o]);
  }
  const out: (Org & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const o of byParent.get(parent) ?? []) {
      out.push({ ...o, depth });
      walk(o.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function CheckLine({ check, onRetry }: { check: Check; onRetry: () => void }) {
  if (check.state === "idle") return null;
  if (check.state === "checking")
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-faint">
        <Loader2 size={12} className="animate-spin" /> Checking with the live service…
      </p>
    );
  return (
    <p className={`mt-2 flex items-center gap-1.5 text-[12px] ${check.state === "ok" ? "text-verify" : "text-[#F3A27E]"}`}>
      {check.state === "ok" ? <Check size={12} /> : <X size={12} />}
      {check.detail}
      {check.state === "fail" && (
        <button type="button" onClick={onRetry} className="ml-2 underline">
          Retry
        </button>
      )}
    </p>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {hint && <span className="ml-2 text-[12px] text-ink-faint">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2 border-t border-hairline pt-5">{children}</div>;
}

const inputCls = "h-10 w-full rounded-sm border border-hairline bg-deck px-3 text-[14px] text-ink outline-none focus:border-[color:var(--role)]";
const primaryCls = "h-10 rounded-sm px-5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const secondaryCls = "h-10 rounded-sm border border-hairline px-4 text-[14px] text-ink-muted hover:text-ink";
