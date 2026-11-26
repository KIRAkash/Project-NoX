// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

import MissionsPage from "@/app/(product)/app/missions/page";
import { ToastProvider } from "@/components/app/ui";
import type { Mission } from "@/lib/app/types";

const reloadMock = vi.fn().mockResolvedValue(undefined);
const apiMock = vi.fn().mockResolvedValue({ updated: 2, missions: [] });
let mockRole: "developer" | "engineering" | "product" | "business" = "developer";
let mockMissions: Mission[] = [];

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/liquid-metal/liquid-metal", () => ({
  LiquidMetalLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/app/auth", () => ({
  useAuth: () => ({
    me: {
      id: "user-1",
      email: "dev@nox.local",
      name: "Dev User",
      role: mockRole,
      capabilities: ["see_atlas", "create_mission"],
    },
  }),
}));

vi.mock("@/lib/app/use-api", () => ({
  useApi: () => ({
    data: mockMissions,
    loading: false,
    error: null,
    reload: reloadMock,
  }),
}));

vi.mock("@/lib/app/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
    ) {
      super(detail);
    }
  },
}));

function makeMission(num: number, stage: Mission["stage"], opts: Partial<Mission> = {}): Mission {
  return {
    id: `00000000-0000-0000-0000-00000000000${num}`,
    key: `NOX-${num}`,
    title: `Mission ${num} title`,
    prompt: `Prompt for mission ${num}`,
    type: "feature",
    priority: "P2",
    stage,
    verifyRole: null,
    createdAsRole: "business",
    awaitingProceed: false,
    proceededWithoutApproval: false,
    orgId: "org-1",
    createdAt: "2026-11-25T10:00:00Z",
    updatedAt: "2026-11-25T10:00:00Z",
    completedAt: stage === "done" ? "2026-11-25T12:00:00Z" : null,
    createdBy: "user-1",
    cancelled: null,
    archived: null,
    files: [
      { role: "business", title: "Business requirement", fileName: "01-business.md", status: "draft", version: 1, approvedAt: null, updatedAt: null, gitPath: null, verification: {} },
      { role: "product", title: "Product spec", fileName: "02-product.md", status: "empty", version: 0, approvedAt: null, updatedAt: null, gitPath: null, verification: {} },
      { role: "engineering", title: "Engineering design", fileName: "03-engineering.md", status: "empty", version: 0, approvedAt: null, updatedAt: null, gitPath: null, verification: {} },
      { role: "developer", title: "Build spec", fileName: "04-developer.md", status: "empty", version: 0, approvedAt: null, updatedAt: null, gitPath: null, verification: {} },
    ],
    apps: [{ id: "app-1", name: "refunds-service" }],
    links: [],
    ...opts,
  };
}

describe("MissionsPage multi-select and FloatingBulkToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = "developer";
    mockMissions = [
      makeMission(1, "done"),
      makeMission(2, "done"),
      makeMission(3, "developer"),
      makeMission(4, "business"),
    ];
  });

  it("displays floating toolbar on row selection, selects all via header checkbox, and clears on Escape", () => {
    render(
      <ToastProvider>
        <MissionsPage />
      </ToastProvider>,
    );

    expect(screen.queryByRole("toolbar", { name: /bulk mission actions/i })).toBeNull();

    const row1 = screen.getByRole("checkbox", { name: /select NOX-1/i });
    fireEvent.click(row1);

    const toolbar = screen.getByRole("toolbar", { name: /bulk mission actions/i });
    expect(toolbar).toBeDefined();
    expect(within(toolbar).getByText("1 selected")).toBeDefined();
    expect(within(toolbar).getByRole("button", { name: /^archive$/i })).toBeDefined();
    expect(within(toolbar).getByRole("button", { name: /delete/i })).toBeDefined();

    // Header select-all selects all 4 visible rows.
    const selectAll = screen.getByRole("checkbox", { name: /select all missions/i });
    fireEvent.click(selectAll);
    expect(within(toolbar).getByText("4 selected")).toBeDefined();

    // Pressing Escape clears selection and hides the floating toolbar.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: /bulk mission actions/i })).toBeNull();
    expect((row1 as HTMLInputElement).checked).toBe(false);
  });

  it("supports Shift+Click range selection across table rows and executes single-request batch archive", async () => {
    render(
      <ToastProvider>
        <MissionsPage />
      </ToastProvider>,
    );

    const row1 = screen.getByRole("checkbox", { name: /select NOX-1/i });
    const row3 = screen.getByRole("checkbox", { name: /select NOX-3/i });

    fireEvent.click(row1);
    fireEvent.click(row3, { shiftKey: true });

    const toolbar = screen.getByRole("toolbar", { name: /bulk mission actions/i });
    expect(within(toolbar).getByText("3 selected")).toBeDefined();

    await act(async () => {
      fireEvent.click(within(toolbar).getByRole("button", { name: /^archive$/i }));
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("/api/v1/missions/batch", {
      method: "PATCH",
      json: {
        ids: [mockMissions[0].id, mockMissions[1].id, mockMissions[2].id],
        status: "archived",
      },
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("toolbar", { name: /bulk mission actions/i })).toBeNull();
  });

  it("supports multi-select across board columns and executes bulk status change in one request", async () => {
    mockRole = "engineering";
    render(
      <ToastProvider>
        <MissionsPage />
      </ToastProvider>,
    );

    // Select NOX-4 (Business lane) and NOX-3 (Developer lane) across columns.
    fireEvent.click(screen.getByRole("checkbox", { name: /select NOX-4/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select NOX-3/i }));

    const toolbar = screen.getByRole("toolbar", { name: /bulk mission actions/i });
    expect(within(toolbar).getByText("2 selected")).toBeDefined();

    const statusSelect = within(toolbar).getByRole("combobox", { name: /bulk status/i });
    await act(async () => {
      fireEvent.change(statusSelect, { target: { value: "done" } });
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("/api/v1/missions/batch", {
      method: "PATCH",
      json: {
        ids: [mockMissions[3].id, mockMissions[2].id],
        status: "done",
      },
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("executes atomic batch delete when all selected missions are deletable", async () => {
    mockMissions = [makeMission(4, "business"), makeMission(5, "business")];
    render(
      <ToastProvider>
        <MissionsPage />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /select all missions/i }));
    const toolbar = screen.getByRole("toolbar", { name: /bulk mission actions/i });
    fireEvent.click(within(toolbar).getByRole("button", { name: /delete/i }));

    await act(async () => {
      fireEvent.click(within(toolbar).getByRole("button", { name: /confirm delete/i }));
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("/api/v1/missions/batch/delete", {
      method: "POST",
      json: {
        ids: [mockMissions[0].id, mockMissions[1].id],
      },
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
