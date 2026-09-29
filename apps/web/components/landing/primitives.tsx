import type { ReactNode } from "react";

export function NoxMark({ size = 22, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.4" fill="#F7B542" />
      <circle
        cx="12"
        cy="12"
        r="9.2"
        stroke="rgba(247,181,66,.4)"
        strokeWidth="1"
        strokeDasharray="2.4 3.2"
        className={spin ? "[animation:spin_34s_linear_infinite] [transform-origin:center]" : undefined}
      />
    </svg>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-[22px] font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
      {children}
    </div>
  );
}

/** The one headline shape the page uses: a display-italic accent word in a grotesque line. */
export function Accent({ children, tone = "nox" }: { children: ReactNode; tone?: "nox" | "ember" | "ice" | "verify" }) {
  const color = { nox: "text-nox", ember: "text-ember", ice: "text-ice", verify: "text-verify" }[tone];
  return (
    <em className={`font-display text-[1.04em] font-normal italic tracking-[-0.01em] ${color}`}>
      {children}
    </em>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: string;
}) {
  return (
    <div className="mb-14 flex flex-col gap-8 lg:flex-row lg:items-end lg:gap-[72px]">
      <div data-reveal data-reveal-group="head" className="lg:w-[640px] lg:shrink-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.024em] text-ink sm:text-[42px] lg:text-[50px]">
          {title}
        </h2>
      </div>
      <p
        data-reveal
        data-reveal-group="head"
        className="max-w-[420px] text-[15px] leading-[1.65] text-ink-muted lg:text-base [text-wrap:pretty]"
      >
        {lede}
      </p>
    </div>
  );
}

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative w-full border-b border-hairline py-[72px] sm:py-[100px] lg:py-[118px] ${className}`}
    >
      <div className="relative z-[2] mx-auto max-w-shell px-5 sm:px-8 lg:px-12">{children}</div>
    </section>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-[50px] items-center justify-center rounded-sm bg-nox px-[26px] font-mono text-xs font-medium uppercase tracking-[0.1em] text-[#120D04] transition-[background,box-shadow] duration-300 hover:bg-[#FFC861] hover:shadow-[0_16px_48px_-20px_rgba(247,181,66,0.85)]"
    >
      {children}
    </a>
  );
}

export function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-[50px] items-center justify-center rounded-sm border border-[rgba(143,160,204,0.24)] px-6 font-mono text-xs uppercase tracking-[0.1em] text-ink-muted transition-colors duration-300 hover:border-[rgba(143,160,204,0.42)] hover:bg-[rgba(134,185,238,0.06)] hover:text-ink"
    >
      {children}
    </a>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M2 8.6 6.1 12.6 14 4.2" stroke="#5FD29F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Warn({ color = "#E9713C", size = 15 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M8 1.6 14.2 12.4H1.8L8 1.6Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.2v2.6M8 10.6v.1" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
