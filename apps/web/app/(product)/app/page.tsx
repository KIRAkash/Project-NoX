"use client";

import { ArrowRight, Plus } from "lucide-react";
import { useState } from "react";

import { BusinessHome } from "@/components/app/homes/business";
import { DeveloperHome } from "@/components/app/homes/developer";
import { EngineeringHome } from "@/components/app/homes/engineering";
import { ProductHome } from "@/components/app/homes/product";
import { greeting } from "@/components/app/homes/shared";
import { PlanetCharacter } from "@/components/app/planet-character";
import { Panel } from "@/components/app/ui";
import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";
import { useAuth } from "@/lib/app/auth";
import { PRIMARY_ACTION } from "@/lib/app/nav";
import { ROLE_BY_ID, type RoleDef, type RoleId } from "@/lib/app/roles";

/** Each seat has its own cockpit below the shared greeting. */
const HOME: Record<RoleId, (props: { role: RoleDef }) => React.ReactNode> = {
  business: BusinessHome,
  product: ProductHome,
  engineering: EngineeringHome,
  developer: DeveloperHome,
};

export default function Home() {
  const { me } = useAuth();
  const role = ROLE_BY_ID[me!.role!];
  const action = PRIMARY_ACTION[role.id];
  const SeatHome = HOME[role.id];
  const [hovered, setHovered] = useState(false);

  return (
    <div className="mx-auto max-w-shell">
      <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-1">
          {/* room for what sticks out past the planet: rings, signal arcs, the moon */}
          <span
            className="shrink-0 pt-3"
            style={{ paddingInline: 72 * (role.feature === "ring" ? 0.38 : 0.28) }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <PlanetCharacter role={role} size={72} active={hovered} />
          </span>
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: role.ink }}>
              {role.deskLine}
            </span>
            <h1 className="mt-1 font-display text-[34px] leading-tight text-ink sm:text-[40px]">
              {greeting()}
              {me!.name ? `, ${me!.name.split(" ")[0]}` : ""}.
            </h1>
          </div>
        </div>
        {/* The business user's composer is the page itself, so no button for them. */}
        {role.id !== "business" && (
          <LiquidMetalLink
            href={`/app${action.path}`}
            data-tour="primary-action"
            hue={role.hue}
            className="inline-flex h-11 items-center gap-2 self-start rounded-sm px-5 text-[14px] font-semibold sm:self-auto"
          >
            <Plus size={16} strokeWidth={2.4} />
            {action.label}
          </LiquidMetalLink>
        )}
      </section>

      {me!.orgs.length === 0 && <FreshStart role={role} />}
      <SeatHome role={role} />
    </div>
  );
}

/**
 * Someone who started fresh (or left the demo) has no organizations yet. The engineering lead charts one; every other
 * seat is pointed there, or back to the demo estate.
 */
function FreshStart({ role }: { role: RoleDef }) {
  const { me, chooseRole, chooseEstate } = useAuth();
  const [busy, setBusy] = useState(false);
  const lead = role.id === "engineering";
  const run = async (fn: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    try {
      await fn();
      then?.();
    } finally {
      setBusy(false);
    }
  };
  const demo = me!.demoAvailable && (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run(() => chooseEstate("demo"), () => window.location.assign("/app"))}
      className="inline-flex h-10 items-center gap-2 rounded-sm border border-hairline px-4 text-[13px] text-ink-muted hover:text-ink disabled:opacity-50"
    >
      Explore the demo instead
    </button>
  );

  return (
    <Panel title="An empty sky" className="mt-8" tour="fresh-start">
      <h2 className="font-display text-[24px] leading-tight text-ink">{lead ? "Chart your first organization" : "Nothing in your orbit yet"}</h2>
      <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-ink-muted">
        {lead
          ? "Add your company, then its teams. Then onboard an application and NoX builds its code wiki from the repository."
          : "Applications live in organizations, and an engineering lead charts them. Ask one to invite you, or take that seat and chart your own."}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {lead ? (
          <LiquidMetalLink href="/app/atlas" hue={role.hue} className="inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[13px] font-semibold">
            <Plus size={15} strokeWidth={2.4} /> Chart an organization
          </LiquidMetalLink>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => chooseRole("engineering"))}
            className="inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[13px] font-semibold text-abyss disabled:opacity-50"
            style={{ background: ROLE_BY_ID.engineering.hue }}
          >
            Switch to Engineering lead <ArrowRight size={15} />
          </button>
        )}
        {demo}
      </div>
    </Panel>
  );
}
