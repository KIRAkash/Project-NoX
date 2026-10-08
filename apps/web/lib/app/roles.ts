/** The four seats of the role picker. One colour per role, used everywhere the role appears. */

export type RoleId = "business" | "product" | "engineering" | "developer";

export type RoleDef = {
  id: RoleId;
  name: string;
  /** One-to-two lines under the planet on the role picker. */
  blurb: string;
  /** The seat's own pale hue: planets, halos and washes. */
  hue: string;
  /** The seat's colour as a CSS variable that stays legible as text in either theme (see globals.css). */
  ink: string;
  /** Planet surface: highlight → base → shadow. */
  surface: [string, string, string];
  feature: "plain" | "moon" | "ring" | "bands";
  /** The seat's cockpit: its name in the shell and the one line under it. */
  desk: string;
  deskLine: string;
  /** What the missions page is called from this seat. */
  missionsLabel: string;
};

export const ROLES: RoleDef[] = [
  {
    id: "business",
    name: "Business user",
    blurb: "Ask for a change in one plain sentence. Confirm at the end that what shipped is what you meant.",
    hue: "#E8C97A",
    ink: "var(--seat-business)",
    surface: ["#FFF3CF", "#E8C97A", "#8C6A22"],
    feature: "ring",
    desk: "Request desk",
    deskLine: "Ask, follow, confirm",
    missionsLabel: "My requests",
  },
  {
    id: "product",
    name: "Product owner",
    blurb: "Turn a request into a product spec — goals, acceptance criteria, edge cases, the metric. Configure applications.",
    hue: "#A897F0",
    ink: "var(--seat-product)",
    surface: ["#E6E0FF", "#A897F0", "#4F3F9E"],
    feature: "moon",
    desk: "Product board",
    deskLine: "Triage, specify, accept",
    missionsLabel: "Backlog",
  },
  {
    id: "engineering",
    name: "Engineering lead",
    blurb: "Decide which applications change and what must not break. Own the org hierarchy and the atlas.",
    hue: "#5FCBD8",
    ink: "var(--seat-engineering)",
    surface: ["#D6F7FB", "#5FCBD8", "#1F6B75"],
    feature: "plain",
    desk: "Flight director",
    deskLine: "Design, scope, protect",
    missionsLabel: "Design reviews",
  },
  {
    id: "developer",
    name: "Developer",
    blurb: "Onboard applications, generate code wikis, and build missions with your own coding agent via /nox.",
    hue: "#86B9EE",
    ink: "var(--seat-developer)",
    surface: ["#E3F0FF", "#86B9EE", "#2D5C91"],
    feature: "bands",
    desk: "Build bay",
    deskLine: "Build, ship, prove",
    missionsLabel: "Build queue",
  },
];

export const ROLE_BY_ID: Record<RoleId, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, RoleDef>;

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && value in ROLE_BY_ID;
}

/** Seats that aren't playable yet. The role picker shows them as a "coming soon" planet. */
export const UPCOMING_ROLES: { name: string; hue: string }[] = [
  { name: "Sales", hue: "#F3A27E" },
  { name: "Design", hue: "#E79AD0" },
  { name: "Security & Compliance", hue: "#7FD6A4" },
  { name: "QA", hue: "#C3D86A" },
];
