"use client";

import dynamic from "next/dynamic";

// `ssr: false` needs a Client Component boundary in the App Router — this is
// that boundary, kept separate from app/intro/page.tsx so the page itself
// can stay a Server Component and export its own metadata.
const NoxReveal = dynamic(() => import("./nox-reveal"), { ssr: false });

export default function RevealLoader() {
  return <NoxReveal />;
}
