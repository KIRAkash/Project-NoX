/**
 * The demo company's logo. Tidewell Mutual is a mock insurer we built for the demo, so its mark is ours too: a tide
 * line over a well, in deep sea teal. Other demo estates get a monogram in the same badge.
 */
export function OrgMark({ name, size = 32 }: { name: string; size?: number }) {
  const tidewell = name.toLowerCase().startsWith("tidewell");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="org-mark-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1A8A9C" />
          <stop offset="100%" stopColor="#0B3B52" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#org-mark-sea)" />
      {tidewell ? (
        <>
          <circle cx="16" cy="10.5" r="3.4" fill="#F6D58A" />
          <path d="M6.5 18.2c2.4-2.6 4.8-2.6 7.2 0s4.8 2.6 7.2 0 3.6-2 4.6-1.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d="M6.5 23.4c2.4-2.6 4.8-2.6 7.2 0s4.8 2.6 7.2 0 3.6-2 4.6-1.2" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <text x="16" y="21.5" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700" fontFamily="var(--font-display), sans-serif">
          {name.charAt(0).toUpperCase()}
        </text>
      )}
    </svg>
  );
}

/** The mark with the name set as a wordmark: "Tidewell" large, "Mutual" small and spaced, the way insurers sign. */
export function OrgLockup({ name, note, compact = false }: { name: string; note?: string; compact?: boolean }) {
  const [first, ...rest] = name.split(" ");
  return (
    <span className="flex flex-col items-center gap-1.5 text-center">
      <span className="flex items-center gap-2.5">
        <OrgMark name={name} size={compact ? 30 : 40} />
        <span className="flex flex-col items-start leading-none">
          <span className={`font-display font-semibold tracking-[-0.01em] text-ink ${compact ? "text-[19px]" : "text-[25px]"}`}>{first}</span>
          {rest.length > 0 && <span className={`mt-1 font-sans font-semibold uppercase tracking-[0.32em] text-ink-muted ${compact ? "text-[8.5px]" : "text-[10px]"}`}>{rest.join(" ")}</span>}
        </span>
      </span>
      {note && <span className={`text-ink-faint ${compact ? "text-[11px]" : "text-[12.5px]"}`}>{note}</span>}
    </span>
  );
}
