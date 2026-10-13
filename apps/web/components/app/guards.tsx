"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/app/auth";

/**
 * Signed-out visitors go to /login (and come back afterwards). A first sign-in goes to the welcome screen, then the
 * role picker; signed-in users without a role go to the picker. `needOnboarded={false}` lets a page skip the welcome
 * (the welcome itself, and the CLI's device sign-in).
 */
export function RequireAuth({ children, needRole = true, needOnboarded = true }: { children: React.ReactNode; needRole?: boolean; needOnboarded?: boolean }) {
  const { status, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const welcome = needOnboarded && me !== null && !me.onboarded;

  useEffect(() => {
    if (status === "signed-out") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === "signed-in" && welcome) router.replace("/welcome");
    else if (status === "signed-in" && needRole && !me?.role) router.replace("/choose-role");
  }, [status, me, needRole, welcome, pathname, router]);

  if (status !== "signed-in" || welcome || (needRole && !me?.role)) return <Loading />;
  return <>{children}</>;
}

export function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
      <span className="h-3 w-3 animate-ping rounded-full bg-nox" />
    </div>
  );
}
