import { Activity, Layers, Map as MapIcon, Orbit, Rocket, SquareTerminal, type LucideIcon } from "lucide-react";

import { ROLE_BY_ID, type RoleId } from "./roles";

export type NavItem = {
  key: string;
  label: string;
  /** Path under /app. */
  path: string;
  icon: LucideIcon;
};

const ITEM: Record<string, NavItem> = {
  home: { key: "home", label: "Home", path: "", icon: Orbit },
  missions: { key: "missions", label: "Missions", path: "/missions", icon: Rocket },
  atlas: { key: "atlas", label: "Atlas", path: "/atlas", icon: MapIcon },
  specs: { key: "artifacts", label: "Specs", path: "/artifacts", icon: Layers },
  activity: { key: "activity", label: "Activity", path: "/activity", icon: Activity },
  cli: { key: "cli", label: "CLI", path: "/cli", icon: SquareTerminal },
};

/** Each seat gets its own short nav: the business user sees only their requests; the developer gets the CLI. */
const SEAT_NAV: Record<RoleId, string[]> = {
  business: ["home", "missions"],
  product: ["home", "missions", "atlas", "specs"],
  engineering: ["home", "missions", "atlas", "activity"],
  developer: ["home", "missions", "atlas", "cli"],
};

export function navFor(role: RoleId): NavItem[] {
  return SEAT_NAV[role].map((k) => (k === "missions" ? { ...ITEM.missions, label: ROLE_BY_ID[role].missionsLabel } : ITEM[k]));
}

/** The single most important action on each role's home. */
export const PRIMARY_ACTION: Record<RoleId, { label: string; path: string }> = {
  business: { label: "Ask for a change", path: "/missions/new" },
  product: { label: "New mission", path: "/missions/new" },
  engineering: { label: "Review designs", path: "/missions" },
  developer: { label: "Onboard application", path: "/atlas/new" },
};
