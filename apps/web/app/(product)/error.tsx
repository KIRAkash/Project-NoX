"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">Lost signal</p>
      <h1 className="mt-3 text-[26px] text-ink">Something went wrong on this page.</h1>
      <p className="mt-3 text-[14px] text-ink-muted">Your work is saved — spec files save to NoX and Git as you go. Try again, or head back to your home.</p>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={reset} className="h-10 rounded-sm bg-nox px-5 text-[14px] font-semibold text-void hover:brightness-110">
          Try again
        </button>
        <Link href="/app" className="flex h-10 items-center rounded-sm border border-hairline px-5 text-[14px] text-ink-muted hover:text-ink">
          Home
        </Link>
      </div>
    </main>
  );
}
