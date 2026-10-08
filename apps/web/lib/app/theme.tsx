"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Theme = "dark" | "light";

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  mounted: boolean;
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export const THEME_STORAGE_KEY = "nox-theme";
export const DEFAULT_THEME: Theme = "dark";

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Mutates documentElement attributes and colorScheme styling.
 */
function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;

  // Sync mobile browser status bar tint if meta[name="theme-color"] exists
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "light" ? "#FAF7F5" : "#05060B");
  }
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  // The init script in app/layout.tsx has already set `data-theme` before paint; start from it so
  // client-only components (the landing galaxy) render the right theme on their first frame.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return defaultTheme;
    const dom = document.documentElement.getAttribute("data-theme");
    return dom === "light" || dom === "dark" ? dom : defaultTheme;
  });
  const [mounted, setMounted] = useState<boolean>(false);

  // Sync state with localStorage or pre-hydration DOM attribute on mount
  useEffect(() => {
    let resolvedTheme: Theme = defaultTheme;

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "light" || stored === "dark") {
        resolvedTheme = stored;
      } else {
        const domTheme = document.documentElement.getAttribute("data-theme");
        if (domTheme === "light" || domTheme === "dark") {
          resolvedTheme = domTheme;
        }
      }
    } catch {
      // In private browsing or sandboxed environments, localStorage may throw
    }

    setThemeState(resolvedTheme);
    applyThemeToDocument(resolvedTheme);
    setMounted(true);
  }, [defaultTheme, storageKey]);

  // Synchronize across multiple browser tabs via storage events
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (
        event.key === storageKey &&
        (event.newValue === "light" || event.newValue === "dark")
      ) {
        const nextTheme = event.newValue as Theme;
        setThemeState(nextTheme);
        applyThemeToDocument(nextTheme);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [storageKey]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      applyThemeToDocument(newTheme);

      try {
        window.localStorage.setItem(storageKey, newTheme);
      } catch {
        // Silently handle quota or access errors in restricted environments
      }
    },
    [storageKey]
  );

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = current === "dark" ? "light" : "dark";
      applyThemeToDocument(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {}
      return next;
    });
  }, [storageKey]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme,
      setTheme,
      mounted,
    }),
    [theme, toggleTheme, setTheme, mounted]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return context;
}
