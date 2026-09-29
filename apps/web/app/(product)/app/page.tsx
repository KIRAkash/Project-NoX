"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { BusinessHome } from "@/components/app/homes/business";
import { DeveloperHome } from "@/components/app/homes/developer";
import { EngineeringHome } from "@/components/app/homes/engineering";
import { ProductHome } from "@/components/app/homes/product";
import { greeting } from "@/components/app/homes/shared";
import { PlanetCharacter } from "@/components/app/planet-character";
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
            <span className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: role.hue }}>
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
            hue={role.hue}
            className="inline-flex h-11 items-center gap-2 self-start rounded-sm px-5 text-[14px] font-semibold sm:self-auto"
          >
            <Plus size={16} strokeWidth={2.4} />
            {action.label}
          </LiquidMetalLink>
        )}
      </section>

      <SeatHome role={role} />
    </div>
  );
}
