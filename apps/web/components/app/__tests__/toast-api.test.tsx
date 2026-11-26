// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { api, ApiError } from "@/lib/app/api";
import { resetToastBusForTests } from "@/lib/app/toast";
import { toastApiError, useApi, useApiToast } from "@/lib/app/use-api";
import { ToastProvider, ToastViewport, useToast } from "../toast";

function renderWithToastViewport(ui?: React.ReactNode) {
  return render(
    <ToastProvider withViewport={false}>
      {ui}
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("Global ToastProvider, ToastViewport, api() error dispatch & useApi helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetToastBusForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    resetToastBusForTests();
  });

  it("displays a red ARIA alert toast stating 'Network request failed' when fetch rejects during save", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    renderWithToastViewport(<button type="button">Save workspace</button>);

    let thrown: unknown;
    await act(async () => {
      try {
        await api("/api/v1/missions/NOX-1/files/business", {
          method: "PUT",
          json: { markdown: "# Updated spec", baseVersion: 1 },
        });
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(0);
    expect((thrown as ApiError).detail).toBe("Network request failed");

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("data-toast-tone")).toBe("error");
    expect(screen.getByText("Network request failed")).toBeDefined();
    expect(screen.getByText("Unable to reach NoX right now.")).toBeDefined();
    expect(screen.getByText("Check your connection and try again.")).toBeDefined();

    // Viewport container uses pointer-events-none so underlying form buttons stay clickable
    const viewport = screen.getByTestId("toast-viewport");
    expect(viewport.className).toContain("pointer-events-none");
  });

  it("does not display an error toast when a request is intentionally aborted", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

    renderWithToastViewport();

    await act(async () => {
      await expect(api("/api/v1/missions")).rejects.toMatchObject({ name: "AbortError" });
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("triggers a visible red toast with actionable title, detail, and retry suggestion on 5xx responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({ detail: "Upstream worker pool is restarting" }),
    } as Response);

    function MissionsConsumer() {
      useApi("/api/v1/missions");
      return <div>Missions view</div>;
    }

    await act(async () => {
      renderWithToastViewport(<MissionsConsumer />);
    });

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-toast-tone")).toBe("error");
    expect(screen.getByText("Service temporarily unavailable")).toBeDefined();
    expect(screen.getByText("Upstream worker pool is restarting")).toBeDefined();
    expect(screen.getByText("The server may be restarting. Wait a moment and try again.")).toBeDefined();
  });

  it("auto-dismisses toasts after 5 seconds and supports immediate manual close button dismissal", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ detail: "Database query timed out" }),
    } as Response);

    renderWithToastViewport();

    await act(async () => {
      await expect(api("/api/v1/orgs")).rejects.toThrow("Database query timed out");
    });

    expect(screen.getByRole("alert")).toBeDefined();

    // Still visible at 4.9 seconds
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(screen.getByRole("alert")).toBeDefined();

    // Auto-dismissed once 5 seconds total have elapsed
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByRole("alert")).toBeNull();

    // Trigger another error after throttle window and dismiss manually via close button
    act(() => {
      vi.advanceTimersByTime(3100);
    });

    await act(async () => {
      await expect(api("/api/v1/orgs")).rejects.toThrow("Database query timed out");
    });
    expect(screen.getByRole("alert")).toBeDefined();

    const closeBtn = screen.getByRole("button", { name: /dismiss notification/i });
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("throttles duplicate error toasts within a 3-second window and allows re-emission afterwards", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    function SaveCallerWithCatchToast() {
      const toast = useToast();
      const trigger = async () => {
        try {
          await api("/api/v1/missions/NOX-2/files/product", { method: "PUT", json: {} });
        } catch (e) {
          toast(e instanceof ApiError ? e.detail : "Couldn't save", "error");
        }
      };
      return (
        <button type="button" onClick={() => void trigger()}>
          Trigger Save
        </button>
      );
    }

    renderWithToastViewport(<SaveCallerWithCatchToast />);

    const btn = screen.getByRole("button", { name: "Trigger Save" });

    // Click twice rapidly within the 3-second window (each click triggers api() + catch toast())
    await act(async () => {
      fireEvent.click(btn);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getAllByRole("alert")).toHaveLength(1);

    // Advance past the 3-second throttle window (total 3.2s < 5s auto-dismiss of first toast)
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("stacks multiple distinct concurrent errors cleanly in the bottom viewport corner", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({ detail: "Failed to load mission timeline" }),
        } as Response;
      }
      return {
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => ({ detail: "Jira sync service unreachable" }),
      } as Response;
    });

    renderWithToastViewport();

    await act(async () => {
      await Promise.allSettled([api("/api/v1/missions/NOX-1/events"), api("/api/v1/missions/NOX-1/jira")]);
    });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(screen.getByText("Failed to load mission timeline")).toBeDefined();
    expect(screen.getByText("Jira sync service unreachable")).toBeDefined();
  });

  it("exposes custom error message options and toast alert helpers in use-api.ts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({ detail: "Repository URL must point to GitHub" }),
    } as Response);

    function CustomHookComponent() {
      const { error, toastError } = useApi("/api/v1/kb/validate", {
        errorMessage: "Couldn't validate repository",
        retrySuggestion: "Enter a valid GitHub repository URL and try again.",
      });
      const { toastError: manualToastError } = useApiToast();

      return (
        <div>
          <span>{error ? error.detail : "ok"}</span>
          <button
            type="button"
            onClick={() =>
              manualToastError("Workspace sync paused", {
                detail: "Token expired for GitHub connector",
                suggestion: "Reconnect GitHub in Atlas settings.",
              })
            }
          >
            Custom Alert
          </button>
          <button type="button" onClick={() => toastError("Manual re-alert")}>
            Re-alert
          </button>
        </div>
      );
    }

    await act(async () => {
      renderWithToastViewport(<CustomHookComponent />);
    });

    expect(screen.getByText("Couldn't validate repository")).toBeDefined();
    expect(screen.getAllByText("Repository URL must point to GitHub").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Enter a valid GitHub repository URL and try again.")).toBeDefined();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Custom Alert" }));
    });

    expect(screen.getByText("Workspace sync paused")).toBeDefined();
    expect(screen.getByText("Token expired for GitHub connector")).toBeDefined();
    expect(screen.getByText("Reconnect GitHub in Atlas settings.")).toBeDefined();

    act(() => {
      toastApiError(new ApiError(504, "Gateway timeout from model runner"), "Draft generation timed out");
    });

    expect(screen.getByText("Draft generation timed out")).toBeDefined();
    expect(screen.getByText("Gateway timeout from model runner")).toBeDefined();
  });
});
