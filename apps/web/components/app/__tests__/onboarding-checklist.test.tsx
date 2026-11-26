// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { OnboardingChecklist } from "../onboarding-checklist";
import { ROLE_BY_ID } from "@/lib/app/roles";
import type { OnboardingChecklistData } from "@/lib/app/types";

const mockApi = vi.fn();
const mockMe = {
  id: "user-1",
  email: "lead@acme.test",
  name: "Ada Lovelace",
  photoUrl: null,
  role: "engineering" as const,
  capabilities: ["see_atlas", "manage_orgs", "invite_members", "onboard_app", "create_mission"],
  orgs: [{ id: "org-1", name: "Acme", slug: "acme", parentOrgId: null }],
  onboarded: true,
  estate: "fresh" as const,
  inDemo: false,
  demoAvailable: false,
  toursSeen: [],
};

vi.mock("@/lib/app/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

vi.mock("@/lib/app/auth", () => ({
  useAuth: () => ({ me: mockMe }),
}));

function makeChecklist(completedKeys: OnboardingChecklistData["completedSteps"], dismissed = false): OnboardingChecklistData {
  const allSteps: OnboardingChecklistData["steps"] = [
    {
      key: "create_org",
      title: "Chart your organization",
      description: "Create your workspace organization and team structure in the Atlas.",
      href: "/app/atlas",
      actionLabel: "Chart organization",
      completed: completedKeys.includes("create_org"),
    },
    {
      key: "link_connector",
      title: "Connect repository",
      description: "Link a GitHub repository or knowledge connector to build your first code wiki.",
      href: "/app/atlas/new",
      actionLabel: "Connect repository",
      completed: completedKeys.includes("link_connector"),
    },
    {
      key: "invite_seat",
      title: "Invite a seat",
      description: "Invite a teammate to collaborate across business, product, engineering, and developer seats.",
      href: "/app/atlas#members",
      actionLabel: "Invite a seat",
      completed: completedKeys.includes("invite_seat"),
    },
    {
      key: "launch_mission",
      title: "Launch a mission",
      description: "Start your first mission and let NoX co-write the specification.",
      href: "/app/missions/new",
      actionLabel: "Launch a mission",
      completed: completedKeys.includes("launch_mission"),
    },
  ];
  const completedCount = completedKeys.length;
  return {
    workspaceId: "org-1",
    workspaceName: "Acme",
    completedSteps: completedKeys,
    completedCount,
    totalCount: 4,
    progressPercent: Math.round((completedCount * 100) / 4),
    completed: completedCount === 4,
    dismissed,
    steps: allSteps,
  };
}

describe("OnboardingChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders 1 of 4 steps completed with deep-links and updates progress in real time", async () => {
    mockApi
      .mockResolvedValueOnce(makeChecklist(["create_org"]))
      .mockResolvedValueOnce(makeChecklist(["create_org", "link_connector"]));

    render(<OnboardingChecklist role={ROLE_BY_ID.engineering} />);

    await waitFor(() => {
      expect(screen.getByText("1 of 4 steps completed")).toBeDefined();
    });
    expect(screen.getByText("25%")).toBeDefined();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");

    const repoLinks = screen.getAllByRole("link", { name: /connect repository/i });
    expect(repoLinks[0].getAttribute("href")).toBe("/app/atlas/new");
    expect(screen.getByRole("link", { name: /invite a seat/i }).getAttribute("href")).toBe("/app/atlas#members");
    expect(screen.getByRole("link", { name: /launch a mission/i }).getAttribute("href")).toBe("/app/missions/new");

    await act(async () => {
      window.dispatchEvent(new CustomEvent("nox:api-mutation", { detail: { path: "/api/v1/orgs/org-1/apps", method: "POST" } }));
    });

    await waitFor(() => {
      expect(screen.getByText("2 of 4 steps completed")).toBeDefined();
    });
    expect(screen.getByText("50%")).toBeDefined();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
  });

  it("hides automatically when all 4 setup steps are completed", async () => {
    mockApi.mockResolvedValueOnce(makeChecklist(["create_org", "link_connector", "invite_seat", "launch_mission"]));

    const { container } = render(<OnboardingChecklist role={ROLE_BY_ID.engineering} />);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/v1/me/checklist");
    });
    expect(container.querySelector('[data-testid="onboarding-checklist"]')).toBeNull();
  });

  it("dismisses manually and persists preference in localStorage and workspace settings", async () => {
    mockApi
      .mockResolvedValueOnce(makeChecklist(["create_org"]))
      .mockResolvedValueOnce(makeChecklist(["create_org"], true));

    render(<OnboardingChecklist role={ROLE_BY_ID.engineering} />);

    const dismissBtn = await screen.findByRole("button", { name: /dismiss checklist/i });
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(screen.queryByTestId("onboarding-checklist")).toBeNull();
    expect(window.localStorage.getItem("nox.onboardingChecklist.dismissed.user-1.org-1")).toBe("1");
    expect(mockApi).toHaveBeenCalledWith("/api/v1/me/checklist/dismiss", {
      method: "POST",
      json: { orgId: "org-1" },
    });
  });
});
