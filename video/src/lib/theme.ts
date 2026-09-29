/*
 * The landing page's palette, seats and estate, copied from
 * apps/web/tailwind.config.ts, apps/web/lib/app/roles.ts and
 * apps/web/lib/content.ts so the film and the site read as one product.
 */

export const C = {
  void: "#05060B",
  hull: "#07080F",
  deck: "#090B13",
  nox: "#F7B542",
  ember: "#E9713C",
  ice: "#86B9EE",
  verify: "#5FD29F",
  ink: "#ECEFF8",
  muted: "#A6AEC7",
  faint: "#7C86A3",
  dim: "#6E7793",
  hairline: "rgba(143,160,204,0.14)",
  hairlineStrong: "rgba(143,160,204,0.3)",
} as const;

export type Tone = "nox" | "ember" | "ice" | "verify";

export const TONE: Record<Tone, string> = {
  nox: C.nox,
  ember: C.ember,
  ice: C.ice,
  verify: C.verify,
};

/** The sun's surface, the same gradient as the wordmark's O on the landing page. */
export const SUN_SURFACE =
  "radial-gradient(circle at 34% 30%, #FFF7E2, #FFDD82 42%, #F7B542 68%, #E9713C 100%)";

export type Seat = {
  id: "business" | "product" | "engineering" | "developer";
  name: string;
  hue: string;
  /** highlight → base → shadow */
  surface: [string, string, string];
  file: string;
};

export const SEATS: Seat[] = [
  { id: "business", name: "Business user", hue: "#E8C97A", surface: ["#FFF3CF", "#E8C97A", "#8C6A22"], file: "01-business.md" },
  { id: "product", name: "Product owner", hue: "#A897F0", surface: ["#E6E0FF", "#A897F0", "#4F3F9E"], file: "02-product.md" },
  { id: "engineering", name: "Engineering lead", hue: "#5FCBD8", surface: ["#D6F7FB", "#5FCBD8", "#1F6B75"], file: "03-engineering.md" },
  { id: "developer", name: "Developer", hue: "#86B9EE", surface: ["#E3F0FF", "#86B9EE", "#2D5C91"], file: "04-developer.md" },
];

export type App = {
  id: string;
  name: string;
  kind: string;
  hue: string;
  /** orbit radius in world units, starting angle, body size */
  a: number;
  phase: number;
  size: number;
  /** seconds per revolution on the landing page */
  period: number;
};

export const APPS: App[] = [
  { id: "ledger", name: "Ledger Core", kind: "Book of record", hue: "#E8C97A", a: 135.7, phase: 0.35, size: 18.2, period: 44 },
  { id: "identity", name: "Identity", kind: "Platform", hue: "#A897F0", a: 135.7, phase: 3.6, size: 16.8, period: 44 },
  { id: "refunds", name: "Refunds Service", kind: "Domain service", hue: "#86B9EE", a: 218.5, phase: 2.05, size: 14, period: 76 },
  { id: "payments", name: "Payments API", kind: "Public edge", hue: "#EC8FC2", a: 218.5, phase: 4.35, size: 14.8, period: 76 },
  { id: "risk", name: "Risk Engine", kind: "Decisioning", hue: "#E9713C", a: 218.5, phase: 0.2, size: 12.9, period: 76 },
  { id: "portal", name: "Customer Portal", kind: "Front end", hue: "#5FCBD8", a: 301.3, phase: 1.15, size: 12, period: 118 },
  { id: "notify", name: "Notifications", kind: "Fan-out", hue: "#F0877E", a: 301.3, phase: 3.5, size: 11.2, period: 118 },
  { id: "reporting", name: "Reporting", kind: "Analytics", hue: "#5FD29F", a: 301.3, phase: 5.5, size: 11.2, period: 118 },
];

/** Orbital shell tilts, as on the landing page. */
export const SHELL_TILT: Record<number, number> = { 135.7: 0, 218.5: 0.11, 301.3: -0.075 };

/** Pairs of apps that hold a contract with one another. */
export const MESH: [string, string][] = [
  ["refunds", "ledger"],
  ["payments", "ledger"],
  ["refunds", "notify"],
  ["payments", "risk"],
  ["portal", "payments"],
  ["identity", "portal"],
  ["reporting", "ledger"],
];

/** The five knowledge-base states, in the space vocabulary the product uses. */
export const KB_STATES = ["In the Void", "Scanning Nebula", "Compiling Stars", "Awaiting Launch", "In Orbit"];
