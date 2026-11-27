// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  clearAllMissionDrafts,
  clearMissionDraft,
  draftStorageKey,
  EMPTY_DRAFT,
  readMissionDraft,
  writeMissionDraft,
} from "@/lib/app/mission-draft";
import { navGroupsFor } from "@/lib/app/nav";
import { ROLE_BY_ID } from "@/lib/app/roles";
import { CliPanel } from "@/components/app/homes/developer";
import { findTarget } from "@/components/app/tour/tour";
import { WorkspaceSetup } from "@/components/app/workspace-setup";

vi.mock("@/lib/app/auth", () => ({
  useAuth: () => ({
    me: {
      id: "user-1",
      email: "lead@example.com",
      name: "Alex",
      role: "engineering",
      capabilities: ["manage_orgs", "onboard_app", "see_atlas", "create_mission"],
      estateChosen: true,
      demoMember: false,
      demoAvailable: true,
      toursSeen: [],
      orgs: [{ id: "org-1", name: "Acme Financial", slug: "acme-financial" }],
      readiness: { orgs: 1, apps: 0, publishedWikis: 0, missions: 0 },
    },
    chooseRole: vi.fn().mockResolvedValue(undefined),
    chooseEstate: vi.fn().mockResolvedValue(undefined),
    refreshMe: vi.fn().mockResolvedValue(null),
  }),
}));

describe("User-scoped mission draft storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("scopes drafts strictly by user ID and clears empty or submitted drafts", () => {
    writeMissionDraft("user-a", {
      prompt: "Show settlement date on client trades",
      type: "bug",
      jiraKey: "APEX-42",
      mediaIds: ["m-1"],
      hiddenMediaIds: ["m-0"],
    });
    writeMissionDraft("user-b", {
      prompt: "Different user's draft",
      type: "feature",
      jiraKey: null,
      mediaIds: [],
      hiddenMediaIds: [],
    });

    expect(readMissionDraft("user-a")).toMatchObject({
      prompt: "Show settlement date on client trades",
      type: "bug",
      jiraKey: "APEX-42",
      mediaIds: ["m-1"],
      hiddenMediaIds: ["m-0"],
    });
    expect(readMissionDraft("user-b").prompt).toBe("Different user's draft");
    expect(readMissionDraft("user-c")).toEqual(EMPTY_DRAFT);

    clearMissionDraft("user-a");
    expect(readMissionDraft("user-a")).toEqual(EMPTY_DRAFT);
    expect(window.localStorage.getItem(draftStorageKey("user-a"))).toBeNull();
    expect(readMissionDraft("user-b").prompt).toBe("Different user's draft");

    clearAllMissionDrafts();
    expect(readMissionDraft("user-b")).toEqual(EMPTY_DRAFT);
  });
});

describe("Progressive navigation grouping", () => {
  it("keeps Home, Missions, and Atlas primary and groups secondary links under More", () => {
    for (const role of ["business", "product", "engineering", "developer"] as const) {
      const { primary, secondary } = navGroupsFor(role);
      expect(primary.map((i) => i.key)).toEqual(["home", "missions", "atlas"]);
      expect(secondary.length).toBeGreaterThanOrEqual(2);
      expect(secondary.some((i) => i.key === "home" || i.key === "atlas")).toBe(false);
    }
  });
});

describe("WorkspaceSetup readiness banner", () => {
  it("stays visible at 1 of 3 complete when an empty organization exists and toggles panels", () => {
    render(
      <WorkspaceSetup
        role={ROLE_BY_ID.engineering}
        readinessOverride={{ orgs: 1, apps: 0, publishedWikis: 0, missions: 0 }}
      />,
    );

    expect(screen.getByText(/Workspace setup · 1 of 3 complete/i)).toBeDefined();
    expect(screen.getByText(/Acme Financial charted/i)).toBeDefined();
    expect(screen.getByText(/Onboard first application/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /Open Atlas/i }).getAttribute("href")).toBe("/app/atlas");

    const toggle = screen.getByRole("button", { name: /Show all panels/i });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Hide empty panels/i })).toBeDefined();
  });

  it("hides completely once organizations, applications, and missions all exist", () => {
    const { container } = render(
      <WorkspaceSetup
        role={ROLE_BY_ID.engineering}
        readinessOverride={{ orgs: 1, apps: 2, publishedWikis: 1, missions: 1 }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("CliPanel progressive copy", () => {
  it("hides internal install.sh path and NOX-n placeholder when zero missions exist", () => {
    const { rerender } = render(<CliPanel tokens={[]} loading={false} hasMissions={false} />);
    expect(screen.queryByText(/packages\/nox-cli\/install\.sh/i)).toBeNull();
    expect(screen.queryByText(/NOX-n/)).toBeNull();
    expect(screen.getByText(/\$ nox login/)).toBeDefined();

    rerender(
      <CliPanel
        tokens={[{ id: "t-1", name: "laptop", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null }]}
        loading={false}
        hasMissions={false}
      />,
    );
    expect(screen.queryByText(/NOX-n/)).toBeNull();
    expect(screen.getByText(/mission commands appear once your first mission starts/i)).toBeDefined();

    rerender(
      <CliPanel
        tokens={[{ id: "t-1", name: "laptop", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null }]}
        loading={false}
        hasMissions={true}
      />,
    );
    expect(screen.getByText(/\/nox NOX-n/)).toBeDefined();
  });
});

describe("Guided tour hidden-anchor guard", () => {
  it("skips hidden, aria-hidden, and zero-rect tour anchors", () => {
    document.body.innerHTML = `
      <div hidden><div id="in-hidden" data-tour="nav-impact">Impact</div></div>
      <div style="display: none" id="display-none" data-tour="design-queue">Queue</div>
      <div id="zero-rect" data-tour="scope-check">Scope</div>
      <div id="visible" data-tour="composer">Composer</div>
    `;
    const visible = document.getElementById("visible")!;
    Object.defineProperty(visible, "getBoundingClientRect", {
      value: () => ({ width: 240, height: 80, top: 20, left: 20, right: 260, bottom: 100 }),
    });
    Object.defineProperty(visible, "getClientRects", {
      value: () => [{ width: 240, height: 80 }],
    });

    expect(findTarget("nav-impact")).toBeNull();
    expect(findTarget("design-queue")).toBeNull();
    expect(findTarget("scope-check")).toBeNull();
    expect(findTarget("composer")).toBe(visible);
  });
});
