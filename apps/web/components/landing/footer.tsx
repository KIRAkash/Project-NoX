import { NoxMark } from "./primitives";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "#atlas", label: "Atlas" },
      { href: "#lifecycle", label: "Lifecycle" },
      { href: "#verify", label: "Verification" },
      { href: "#agents", label: "Agent downlink" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "#agents", label: "CLI reference" },
      { href: "#atlas", label: "Compiler rules" },
      { href: "#access", label: "Deployment" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative w-full border-t border-hairline bg-[#04050A]">
      <div className="mx-auto flex max-w-shell flex-col gap-10 px-5 pb-11 pt-[52px] sm:px-8 lg:flex-row lg:gap-16 lg:px-12">
        <div className="flex flex-col gap-3.5 lg:w-[300px] lg:shrink-0">
          <div className="flex items-center gap-[11px]">
            <NoxMark size={20} />
            <span className="font-display text-[21px] text-ink">NoX</span>
          </div>
          <p className="text-[13.5px] leading-[1.6] text-ink-faint">
            The requirement-to-verification substrate for enterprises that already have more systems than
            anyone can hold in their head.
          </p>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-[11px] lg:gap-[11px]">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
                {col.title}
              </div>
              {col.links.map((l) => (
                <a key={l.label} href={l.href} className="inline-flex min-h-[44px] items-center py-3 text-[13.5px] text-ink-muted transition-colors hover:text-ink lg:min-h-0 lg:py-0">
                  {l.label}
                </a>
              ))}
            </div>
          ))}
          <div className="flex flex-col gap-[11px] lg:gap-[11px]">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
              Contact
            </div>
            <span className="text-[13.5px] text-ink-muted">[YOUR CONTACT EMAIL]</span>
            <span className="text-[13.5px] text-ink-muted">[YOUR COMPANY ADDRESS]</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-shell px-5 pb-10 sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center gap-5 border-t border-[rgba(143,160,204,.1)] pt-[22px]">
          <span className="flex-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
            NoX &middot; Private beta
          </span>
          <a href="#access" className="inline-flex min-h-[44px] items-center px-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim transition-colors hover:text-ink-muted">
            Privacy
          </a>
          <a href="#access" className="inline-flex min-h-[44px] items-center px-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim transition-colors hover:text-ink-muted">
            Security
          </a>
        </div>
      </div>
    </footer>
  );
}
