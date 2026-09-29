"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/app/auth";

/** Signed-out visitors go to /login (and come back afterwards); signed-in users without a role go to the picker. */
export function RequireAuth({ children, needRole = true }: { children: React.ReactNode; needRole?: boolean }) {
  const { status, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signed-out") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === "signed-in" && needRole && !me?.role) router.replace("/choose-role");
  }, [status, me, needRole, pathname, router]);

  if (status !== "signed-in" || (needRole && !me?.role)) return <Loading />;
  return <>{children}</>;
}

export function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
      <span className="h-3 w-3 animate-ping rounded-full bg-nox" />
    </div>
  );
}
