# Project: Project-NoX Sunset Amber Light Mode & Dynamic 4-Seat Hue Architecture

## Architecture
Project-NoX is a Next.js 15 / React 19 web application (`apps/web`) with a FastAPI backend (`apps/api`). This project implements a comprehensive "Sunset Amber" light mode where:
1. `#FAF7F5` (warm cream/parchment) is the root background and `#FFFFFF` represents elevated panel cards.
2. The default ambient unauthenticated/landing theme uses Sunset Amber / Ember (`#E9713C` / `#D4561E`).
3. Selecting any of the four enterprise seats dynamically shifts the ambient glow, sidebar well background, active nav states, cockpit glows, and panel headers to that seat's signature hue:
   - **Business User (`business`)**: Solar Gold (`#E8C97A` / `#8A640F`)
   - **Product Owner (`product`)**: Celestial Violet (`#A897F0` / `#553EAB`)
   - **Engineering Lead (`engineering`)**: Blueprint Cyan (`#5FCBD8` / `#12636E`)
   - **Developer (`developer`)**: Telemetry Ice Blue (`#86B9EE` / `#164E88`)
4. A dual-token system (`--role` for text, borders and marks, legible in either theme; `--role-glow` for the seat's pale hue in halos and washes) keeps seat-coloured text at WCAG AA contrast (≥ 4.5:1) on parchment.
5. Dark mode remains 100% intact with zero visual regressions.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | CSS Token Custom Properties | Convert static Tailwind tokens (`void`, `hull`, `deck`, `ink`, `hairline`) to CSS variables backed by `:root` (dark) and `html[data-theme="light"]` (light parchment #FAF7F5) | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Zero-Flash Theme Provider & Script | Add inline hydration script in `app/layout.tsx` and React `ThemeContext`/`useTheme` hook with `localStorage` persistence | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Dynamic 4-Seat Token Extensions | Extend `lib/app/roles.ts` (`ink`) and `globals.css` (`--seat-*`, `--role`, `--role-glow`) with accessible colors for Business, Product, Engineering, Developer, and default Sunset Amber | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Theme Toggle Component | Reusable `ThemeToggle` button for switching between Dark and Light themes with smooth transitions | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Landing Page Header & Theme Toggle | Integrate `ThemeToggle` into `app/page.tsx` fixed header, fix Docs link hover contrast, set `LiquidMetalLink` to Sunset Amber `#E9713C` | M2 | ORIGINAL_REQUEST §R2 |
| 6 | 3D Celestial Scene Light Adaptation | Update `ExperienceScene` shaders, particle field, star corona, orbit rings (`SHELLS`), contract mesh lines, and Bloom threshold for parchment background | M2 | ORIGINAL_REQUEST §R2 |
| 7 | Planet HTML Labels in 3D Scene | Update Drei `<Html>` planet label badges from dark badge to elevated parchment card in light mode | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Experience Loader & Pinned Wordmark | Update `ExperienceLoader` fallback from `bg-void` flash, and wordmark overlay text colors to adapt to light theme | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Landing Nav & 2D Astrolabe Adaptation | Adapt GSAP scroll background in `components/landing/nav.tsx` and label strokes in `orbital-system.tsx` | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Role Picker Page & Planet Characters | Update `/choose-role` page, Coming Soon planet gradient, and role cards to render cleanly on light parchment | M3 | ORIGINAL_REQUEST §R3 |
| 11 | Product Shell (Sidebar, TopBar, BottomNav) | Replace hardcoded dark backgrounds in `shell.tsx` with theme-aware glasses, apply seat tints, add TopBar `ThemeToggle` | M3 | ORIGINAL_REQUEST §R3 |
| 12 | Seat Texture Washes in CSS | Update `[data-seat="..."]` background textures in `globals.css` with delicate washes in light mode | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Core App UI Components | Adapt `Panel`, `FEED_LIST`, `EmptyState`, and status chips in `ui.tsx` to elevated `#FFFFFF` cards with seat-tinted headers | M3 | ORIGINAL_REQUEST §R3 |
| 14 | Missions List & Cards | Update `MissionCard`, stage lanes, priority chips, and orbit arcs to reflect active role hue on light mode cards | M4 | ORIGINAL_REQUEST §R4 |
| 15 | Spec Editor & Markdown Prose | Adapt `SpecEditor` reading/split views, textarea, chat dock, and `.kb-prose` typography for high-contrast light mode | M4 | ORIGINAL_REQUEST §R4 |
| 16 | Atlas Canvas & Contract Map | Adapt `Atlas` AppCards, TeamBoxes, and `ContractMap` SVG planet labels to light mode | M4 | ORIGINAL_REQUEST §R4 |
| 17 | Documentation Pages | Adapt `/docs` layout, sidebar nav, chapter typography, and code blocks for warm parchment | M4 | ORIGINAL_REQUEST §R4 |
| 18 | WCAG AA Contrast Verification | Validate all 4 seats and default amber text against `#FAF7F5` and `#FFFFFF` (minimum 4.5:1) | M5 | Acceptance Criteria |
| 19 | Dark Mode Non-Regression | Verify dark mode remains 100% identical and fully functional | M5 | Acceptance Criteria |
| 20 | Build & Lint Validation | Verify `npm run build:web` and `make lint` succeed without errors | M5 | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Base Theme & Dynamic 4-Seat Foundation | Tokens in `globals.css`, `tailwind.config.ts`, `lib/app/roles.ts`, `ThemeToggle`, `layout.tsx` script | none | DONE |
| M2 | Landing Page & 3D Celestial Scene | `page.tsx`, `nox-experience.tsx`, `experience-scene.tsx`, `experience-loader.tsx`, `nav.tsx`, `LiquidMetalLink` | M1 | DONE |
| M3 | Role Picker & Product Shell | `/choose-role`, `planet-character.tsx`, `shell.tsx`, `ui.tsx` (Panel, chips), `globals.css` seat textures | M1 | DONE |
| M4 | Missions, Spec Editor & Atlas Pages | `mission-card.tsx`, `missions/page.tsx`, `spec-editor.tsx`, `.kb-prose`, `contract-map.tsx`, `/docs/*` | M1, M3 | DONE |
| M5 | E2E Verification & Hardening | Automated build/lint verification, contrast ratio checks across 4 seats, dark mode non-regression audit | M1, M2, M3, M4 | DONE |

## Interface Contracts
### Theme System (`lib/app/theme.tsx` or similar)
- `theme: "dark" | "light"`
- `toggleTheme: () => void`
- `setTheme: (theme: "dark" | "light") => void`
- Stored in `localStorage.getItem("nox-theme")`
- Rendered on `html[data-theme="light"]` or `html[data-theme="dark"]`

### Seat Role Contract (`lib/app/roles.ts`)
```typescript
export interface RoleDef {
  id: RoleId;
  name: string;
  hue: string;           // Ambient tint & radial glow (e.g. #E8C97A)
  ink: string;           // CSS variable, legible as text in either theme (e.g. var(--seat-business))
  surface: [string, string, string];
  ...
}
```
CSS Variables set by `[data-seat="..."]` in `globals.css`:
- `--role`: the active seat's colour for text, active icons, borders (pale in dark, deep in light)
- `--role-glow`: the seat's own pale hue, for glows and washes in both themes

Accent colours and helpers (`C`, `tint()`, `legible()`) live in `lib/app/palette.ts`.

## Code Layout
- `apps/web/app/globals.css`: Root token definitions (`:root`, `html[data-theme="light"]`), seat textures, prose styling
- `apps/web/tailwind.config.ts`: Tailwind color token mappings to CSS variables
- `apps/web/lib/app/theme.tsx`: Theme context provider and hook
- `apps/web/components/app/theme-toggle.tsx`: Theme toggle component
- `apps/web/lib/app/roles.ts`: Role definitions with `ink`
- `apps/web/lib/app/palette.ts`: Accent colours as CSS variables, `tint()` and `legible()`
- `apps/web/app/layout.tsx`: Inline hydration script
- `apps/web/app/page.tsx`: Landing page
- `apps/web/components/experience/*`: 3D celestial experience components
- `apps/web/app/(product)/choose-role/page.tsx`: Role selection
- `apps/web/components/app/shell.tsx`: Product shell (Sidebar, TopBar, BottomNav)
- `apps/web/components/app/ui.tsx`: Core UI components (Panel, EmptyState, chips)
- `apps/web/app/(product)/app/missions/*`: Missions board and detail
- `apps/web/components/app/spec-editor.tsx`: Spec editor
- `apps/web/components/app/contract-map.tsx`: Atlas contract map
- `apps/web/app/docs/*`: Documentation pages
