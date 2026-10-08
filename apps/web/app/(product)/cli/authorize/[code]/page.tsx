"use client";

import { Terminal } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { RequireAuth } from "@/components/app/guards";
import { NoxMark } from "@/components/app/nox-mark";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";

function Authorize() {
  const { code } = useParams<{ code: string }>();
  const { me } = useAuth();
  const [state, setState] = useState<"checking" | "ready" | "approving" | "done" | "error">("checking");
  const [error, setError] = useState("");
  const [name, setName] = useState("nox CLI");

  useEffect(() => {
    api<{ name: string }>(`/api/v1/cli/device/${encodeURIComponent(code)}`)
      .then((d) => {
        setName(d.name);
        setState("ready");
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.detail : "This code isn't valid.");
        setState("error");
      });
  }, [code]);

  const approve = async () => {
    setState("approving");
    try {
      await api("/api/v1/cli/device/approve", { method: "POST", json: { userCode: code } });
      setState("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't approve.");
      setState("error");
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[460px] flex-col justify-center px-4 py-12">
      <NoxMark />
      <div className="mt-8 rounded-md border border-hairline bg-deck p-6">
        <div className="flex items-center gap-2 text-ink">
          <Terminal size={18} /> <h1 className="text-[18px] font-semibold">Sign in the nox CLI</h1>
        </div>
        {state === "checking" && <p className="mt-4 text-[14px] text-ink-faint">Checking the code…</p>}
        {(state === "ready" || state === "approving") && (
          <>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-muted">
              <span className="text-ink">{name}</span> wants to act as <span className="text-ink">{me?.email}</span>: read missions and knowledge bases you can see, and link pull requests.
            </p>
            <p className="mt-4 text-[13px] text-ink-muted">Check the terminal shows the same code:</p>
            <p className="mt-1 font-mono text-[26px] tracking-[0.18em] text-ink">{code.toUpperCase()}</p>
            <LiquidMetalButton disabled={state === "approving"} onClick={() => void approve()} className="mt-6 h-11 w-full rounded-sm text-[14px] font-semibold disabled:opacity-50">
              {state === "approving" ? "Approving…" : "Approve"}
            </LiquidMetalButton>
            <p className="mt-3 text-[12px] text-ink-faint">Didn&rsquo;t run `nox login`? Close this page.</p>
          </>
        )}
        {state === "done" && <p className="mt-4 text-[14px] text-ink-muted">Done — go back to your terminal. You can close this page.</p>}
        {state === "error" && (
          <p className="mt-4 text-[14px] text-[color:var(--coral-ink)]">
            {error}{" "}
            <Link href="/" className="underline">
              Back to NoX
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}

export default function AuthorizePage() {
  return (
    <RequireAuth needRole={false}>
      <Authorize />
    </RequireAuth>
  );
}
