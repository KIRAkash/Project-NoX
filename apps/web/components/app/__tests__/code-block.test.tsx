// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CodeBlock } from "../code-block";

describe("CodeBlock Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders language badge when language class is present", () => {
    render(
      <CodeBlock>
        <code className="language-typescript">{"const x = 1;"}</code>
      </CodeBlock>
    );

    expect(screen.getByText("typescript")).toBeDefined();
    expect(screen.getByRole("button", { name: /copy code/i })).toBeDefined();
  });

  it("hides language badge when no language class or 'text' language is supplied", () => {
    const { rerender } = render(
      <CodeBlock>
        <code>{"echo 'hello'"}</code>
      </CodeBlock>
    );

    expect(screen.queryByText("text")).toBeNull();
    expect(screen.getByRole("button", { name: /copy code/i })).toBeDefined();

    rerender(
      <CodeBlock>
        <code className="language-text">{"plain text"}</code>
      </CodeBlock>
    );

    expect(screen.queryByText("text")).toBeNull();
    expect(screen.getByRole("button", { name: /copy code/i })).toBeDefined();
  });

  it("executes clipboard copy on button click stripping trailing newline", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(
      <CodeBlock>
        <code className="language-bash">{"npm run dev\n"}</code>
      </CodeBlock>
    );

    const copyBtn = screen.getByRole("button", { name: /copy code/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith("npm run dev");
    expect(screen.getByRole("button", { name: /copied/i })).toBeDefined();
    expect(screen.getByText("Copied")).toBeDefined();
  });

  it("resets copied state back to copy after timeout", async () => {
    vi.useFakeTimers();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(
      <CodeBlock>
        <code className="language-json">{'{\n  "ok": true\n}'}</code>
      </CodeBlock>
    );

    const copyBtn = screen.getByRole("button", { name: /copy code/i });

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByRole("button", { name: /copied/i })).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: /copy code/i })).toBeDefined();
  });

  it("handles fallback gracefully when clipboard API is unavailable or rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(
      <CodeBlock>
        <code>{"code snippet"}</code>
      </CodeBlock>
    );

    const copyBtn = screen.getByRole("button", { name: /copy code/i });

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(consoleSpy).toHaveBeenCalledWith("Failed to copy code block:", expect.any(Error));
    expect(screen.getByRole("button", { name: /copy code/i })).toBeDefined();
  });
});
