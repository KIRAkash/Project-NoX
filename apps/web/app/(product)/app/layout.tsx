"use client";

import { RequireAuth } from "@/components/app/guards";
import { AppShell } from "@/components/app/shell";
import { useAuth } from "@/lib/app/auth";

/**
 * One URL for every seat. The acting seat is the one picked on the server (`me.role`), sent on every request as
 * `X-Nox-Role`. Switching seats keeps the URL, so the shell is keyed by seat: everything below remounts and refetches.
 */
function SeatShell({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  return <AppShell key={me?.role ?? "none"}>{children}</AppShell>;
}

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <SeatShell>{children}</SeatShell>
    </RequireAuth>
  );
}
