/**
 * The product lockups, the same ones the pitch PDF uses (brand/sub-brands): NoX Atlas and NoX Missions, plus the
 * Sightings wordmark, whose i's are dotted with a gold and a violet sparkle. Each lockup ships in two versions and
 * the theme picks one in CSS (`.lockup-on-light` / `.lockup-on-dark` in globals.css), so nothing flashes on load.
 */
import type { ReactNode } from "react";

type Product = "atlas" | "missions";

/** The line under a product's logo, in the rhythm of the landing's own "Every mission, delivered." */
export function Tagline({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[19px] font-medium leading-[1.15] tracking-[-0.018em] text-ink-muted sm:text-[23px] lg:text-[26px] ${className}`}>
      {children}
    </p>
  );
}

export function Lockup({ name, className = "" }: { name: Product; className?: string }) {
  const alt = name === "atlas" ? "NoX Atlas" : "NoX Missions";
  return (
    <span className={`inline-block ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/nox-${name}-on-dark.png`} alt={alt} className="lockup-on-dark block h-full w-auto" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/nox-${name}-on-light.png`} alt="" aria-hidden className="lockup-on-light block h-full w-auto" />
    </span>
  );
}

function Sparkle({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="absolute left-1/2 top-[-0.36em] h-[0.27em] w-[0.27em] -translate-x-1/2">
      <path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0z" fill={color} />
    </svg>
  );
}

/** "Sightings" with sparkles for the i-dots, over the Missions lockup at the same width: Sightings is part of Missions. */
export function SightingsMark({ className = "" }: { className?: string }) {
  const dotless = (color: string) => (
    <span className="relative inline-block">
      {"ı"}
      <Sparkle color={color} />
    </span>
  );
  return (
    <span className={`inline-flex flex-col items-stretch ${className}`} role="img" aria-label="Sightings, part of NoX Missions">
      <span aria-hidden className="font-display text-[1em] font-bold leading-none tracking-[-0.02em] text-ink">
        S{dotless("#e9a23b")}ght{dotless("#8b74e6")}ngs
      </span>
      <span aria-hidden className="mt-[0.08em] block w-0 min-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/nox-missions-on-dark.png" alt="" className="lockup-on-dark block h-auto w-full" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/nox-missions-on-light.png" alt="" className="lockup-on-light block h-auto w-full" />
      </span>
    </span>
  );
}
