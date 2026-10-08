"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { NoxMark } from "@/components/app/nox-mark";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { firebaseConfigured, useAuth } from "@/lib/app/auth";

function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

function LoginInner() {
  const { status, me, error, devAuth, signInWithGoogle, signInDev } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState("dev@nox.local");

  useEffect(() => {
    if (status !== "signed-in") return;
    if (!me?.role) router.replace("/choose-role");
    else router.replace(next ?? `/app`);
  }, [status, me, next, router]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <Link href="/" className="absolute left-4 top-5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim hover:text-ink sm:left-8">
        ← Back to the landing page
      </Link>

      <div className="relative mb-10 flex h-28 w-28 items-center justify-center">
        <span className="absolute inset-0 animate-[spin_24s_linear_infinite] rounded-full border border-dashed border-[rgb(var(--nox-rgb)/.25)]" aria-hidden />
        <NoxMark size={34} />
      </div>

      <div className="w-full max-w-[380px] rounded-md border border-hairline bg-[rgb(var(--deck-rgb)/.72)] p-7 backdrop-blur">
        <h1 className="font-display text-[34px] leading-tight text-ink">Enter NoX</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">Sign in to chart your applications and work missions.</p>

        {status === "loading" ? (
          <div className="mt-8 flex h-12 items-center justify-center" role="status" aria-label="Checking your session">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-nox" />
          </div>
        ) : (
          <>
            <LiquidMetalButton
              onClick={() => run(signInWithGoogle)}
              disabled={busy || !firebaseConfigured}
              className="mt-7 flex h-12 w-full items-center justify-center gap-3 rounded-sm text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleIcon />
              Continue with Google
            </LiquidMetalButton>

            {devAuth && (
              <form
                className="mt-5 border-t border-hairline pt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => signInDev(devEmail));
                }}
              >
                <label htmlFor="dev-email" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
                  Local dev sign-in
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="dev-email"
                    type="email"
                    required
                    value={devEmail}
                    onChange={(e) => setDevEmail(e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-3 text-[13px] text-ink outline-none focus:border-[rgb(var(--nox-rgb)/.6)]"
                  />
                  <button type="submit" disabled={busy} className="h-10 rounded-sm border border-hairline px-4 text-[13px] text-ink hover:border-ink-faint">
                    Go
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-sm border border-[rgba(233,113,60,.35)] bg-[rgba(233,113,60,.08)] px-3 py-2 text-[13px] text-[color:var(--coral-ink)]">
            {error}
          </p>
        )}
      </div>

      <p className="mt-6 max-w-[380px] text-center text-[12px] leading-relaxed text-ink-faint">
        Hackathon build. Your Google account is only used to identify you inside NoX.
      </p>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
