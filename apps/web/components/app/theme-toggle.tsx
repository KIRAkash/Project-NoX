"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/app/theme";

export interface ThemeToggleProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "subtle" | "panel" | "ghost";
}

export function ThemeToggle({
  className = "",
  size = "md",
  variant = "subtle",
}: ThemeToggleProps) {
  const { theme, toggleTheme, mounted } = useTheme();

  const isLight = mounted ? theme === "light" : false;

  const handleToggle = () => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.add("theme-transitioning");
      window.setTimeout(() => {
        document.documentElement.classList.remove("theme-transitioning");
      }, 300);
    }
    toggleTheme();
  };

  const sizeStyles = {
    sm: "h-8 w-8",
    md: "h-9 w-9",
    lg: "h-10 w-10",
  }[size];

  const iconSize = {
    sm: 15,
    md: 17,
    lg: 19,
  }[size];

  const variantStyles = {
    subtle:
      "border border-hairline bg-[color-mix(in_srgb,var(--deck)_40%,transparent)] text-ink-muted hover:border-[rgb(var(--line)/.3)] hover:bg-[rgb(var(--line)/.08)] hover:text-ink backdrop-blur-sm",
    panel:
      "border border-hairline bg-hull text-ink-muted hover:border-[color-mix(in_srgb,var(--nox)_40%,transparent)] hover:text-ink",
    ghost:
      "text-ink-muted hover:bg-[rgb(var(--line)/.08)] hover:text-ink",
  }[variant];

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={
        mounted
          ? isLight
            ? "Switch to dark theme"
            : "Switch to light theme"
          : "Toggle theme"
      }
      title={
        mounted
          ? isLight
            ? "Switch to dark theme"
            : "Switch to light theme"
          : "Toggle theme"
      }
      className={`relative inline-flex items-center justify-center rounded-full transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--role)] active:scale-95 ${sizeStyles} ${variantStyles} ${className}`}
    >
      {/* 
        Zero-flash dual-icon rendering:
        Before hydration (mounted = false), CSS classes driven by html[data-theme]
        guarantee the correct icon is visible without any layout shift or flicker.
      */}
      <Sun
        size={iconSize}
        strokeWidth={1.7}
        className="hidden [html[data-theme='light']_&]:block transition-transform duration-300 rotate-0 scale-100 text-ember"
        aria-hidden="true"
      />
      <Moon
        size={iconSize}
        strokeWidth={1.7}
        className="block [html[data-theme='light']_&]:hidden transition-transform duration-300 rotate-0 scale-100 text-ink-muted hover:text-ink"
        aria-hidden="true"
      />
      <span className="sr-only">
        {mounted
          ? isLight
            ? "Light theme active. Click to switch to dark theme."
            : "Dark theme active. Click to switch to light theme."
          : "Toggle theme"}
      </span>
    </button>
  );
}
