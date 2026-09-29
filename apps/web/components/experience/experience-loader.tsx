"use client";

import dynamic from "next/dynamic";

// `ssr: false` needs a Client Component boundary in the App Router — this is
// that boundary, kept separate from app/page.tsx so the page itself can stay
// a Server Component and export its own metadata.
//
// Without a `loading` fallback, this renders nothing at all until the module
// downloads and mounts — a zero-height hero for that whole window. Since the
// journey section below it *is* server-rendered, it briefly sits at the very
// top of the page with nothing above it: exactly the "wrong section flashes
// first, then the galaxy comes in" bug. A same-sized, same-colour placeholder
// keeps the layout's height (and the void backdrop) in place from the very
// first paint, so nothing below it is ever visible before the galaxy mounts.
const NoxExperience = dynamic(() => import("./nox-experience"), {
  ssr: false,
  loading: () => <div className="relative h-[100svh] w-full overflow-hidden bg-void" />,
});

export default function ExperienceLoader() {
  return <NoxExperience />;
}
