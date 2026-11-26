"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApiError } from "@/lib/app/api";
import { C, tint } from "@/lib/app/palette";
import {
  DEFAULT_TOAST_DURATION_MS,
  dispatchApiErrorToast,
  dispatchToast,
  subscribeToastBus,
  type ToastInput,
  type ToastItem,
  type ToastTone,
} from "@/lib/app/toast";

const MAX_VISIBLE_TOASTS = 5;

export type ToastOptions = Partial<Omit<ToastInput, "tone" | "title">>;

export type ToastFn = {
  (input: string | ToastInput, tone?: ToastTone, options?: ToastOptions): string | null;
  error: (title: string, options?: ToastOptions) => string | null;
  success: (title: string, options?: ToastOptions) => string | null;
  info: (title: string, options?: ToastOptions) => string | null;
  dismiss: (id: string) => void;
  clear: () => void;
};

interface ToastStoreContextValue {
  toasts: ToastItem[];
  push: ToastFn;
  dismiss: (id: string) => void;
  pauseTimer: (id: string) => void;
  resumeTimer: (id: string) => void;
}

function createFallbackToastFn(): ToastFn {
  const fn = ((input: string | ToastInput, tone: ToastTone = "info", options?: ToastOptions) => {
    if (typeof input === "string") {
      return dispatchToast({ ...options, title: input, tone });
    }
    return dispatchToast(input);
  }) as ToastFn;
  fn.error = (title, options) => dispatchToast({ ...options, title, tone: "error" });
  fn.success = (title, options) => dispatchToast({ ...options, title, tone: "success" });
  fn.info = (title, options) => dispatchToast({ ...options, title, tone: "info" });
  fn.dismiss = () => {};
  fn.clear = () => {};
  return fn;
}

const FALLBACK_TOAST_FN = createFallbackToastFn();

const ToastStoreContext = createContext<ToastStoreContextValue | null>(null);

type TimerRecord = {
  timeoutId: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  remainingMs: number;
};

export function ToastProvider({
  children,
  withViewport = true,
}: {
  children: React.ReactNode;
  /** When false, caller mounts `<ToastViewport />` explicitly (e.g. in the root Server Component layout). */
  withViewport?: boolean;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, TimerRecord>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const rec = timersRef.current.get(id);
    if (rec?.timeoutId) {
      clearTimeout(rec.timeoutId);
    }
    timersRef.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    },
    [clearTimer],
  );

  const clear = useCallback(() => {
    for (const rec of timersRef.current.values()) {
      if (rec.timeoutId) clearTimeout(rec.timeoutId);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const scheduleAutoDismiss = useCallback(
    (id: string, durationMs: number) => {
      if (durationMs <= 0) return;
      clearTimer(id);
      const startedAt = Date.now();
      const timeoutId = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, durationMs);
      timersRef.current.set(id, {
        timeoutId,
        startedAt,
        remainingMs: durationMs,
      });
    },
    [clearTimer],
  );

  const pauseTimer = useCallback((id: string) => {
    const rec = timersRef.current.get(id);
    if (!rec || !rec.timeoutId) return;
    clearTimeout(rec.timeoutId);
    const elapsed = Date.now() - rec.startedAt;
    rec.timeoutId = null;
    rec.remainingMs = Math.max(400, rec.remainingMs - elapsed);
  }, []);

  const resumeTimer = useCallback(
    (id: string) => {
      const rec = timersRef.current.get(id);
      if (!rec || rec.timeoutId !== null) return;
      scheduleAutoDismiss(id, rec.remainingMs);
    },
    [scheduleAutoDismiss],
  );

  const addToastItem = useCallback(
    (item: ToastItem) => {
      setToasts((prev) => {
        const next = [...prev, item];
        if (next.length > MAX_VISIBLE_TOASTS) {
          const evicted = next.slice(0, next.length - MAX_VISIBLE_TOASTS);
          for (const old of evicted) clearTimer(old.id);
          return next.slice(next.length - MAX_VISIBLE_TOASTS);
        }
        return next;
      });
      scheduleAutoDismiss(item.id, item.durationMs ?? DEFAULT_TOAST_DURATION_MS);
    },
    [clearTimer, scheduleAutoDismiss],
  );

  useEffect(() => {
    return subscribeToastBus(addToastItem);
  }, [addToastItem]);

  // Catch any unhandled Promise rejections from ApiError that weren't already dispatched by `api()`.
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      if (reason instanceof ApiError && !reason.toastDispatched) {
        reason.toastDispatched = true;
        dispatchApiErrorToast({
          status: reason.status,
          detail: reason.detail,
        });
      }
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const rec of timers.values()) {
        if (rec.timeoutId) clearTimeout(rec.timeoutId);
      }
      timers.clear();
    };
  }, []);

  const push = useMemo<ToastFn>(() => {
    const fn = ((input: string | ToastInput, tone: ToastTone = "info", options?: ToastOptions) => {
      if (typeof input === "string") {
        return dispatchToast({ ...options, title: input, tone });
      }
      return dispatchToast(input);
    }) as ToastFn;
    fn.error = (title, options) => dispatchToast({ ...options, title, tone: "error" });
    fn.success = (title, options) => dispatchToast({ ...options, title, tone: "success" });
    fn.info = (title, options) => dispatchToast({ ...options, title, tone: "info" });
    fn.dismiss = dismiss;
    fn.clear = clear;
    return fn;
  }, [dismiss, clear]);

  const hasExplicitViewport = useMemo(
    () =>
      Children.toArray(children).some(
        (child) => isValidElement(child) && child.type === ToastViewport,
      ),
    [children],
  );

  const storeValue = useMemo<ToastStoreContextValue>(
    () => ({
      toasts,
      push,
      dismiss,
      pauseTimer,
      resumeTimer,
    }),
    [toasts, push, dismiss, pauseTimer, resumeTimer],
  );

  return (
    <ToastStoreContext.Provider value={storeValue}>
      {children}
      {withViewport && !hasExplicitViewport && <ToastViewport />}
    </ToastStoreContext.Provider>
  );
}

export function ToastViewport() {
  const store = useContext(ToastStoreContext);
  const toasts = store?.toasts ?? [];

  useEffect(() => {
    if (!store || toasts.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        const latest = toasts[toasts.length - 1];
        if (latest) store.dismiss(latest.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, toasts]);

  return (
    <section
      aria-label="Notifications"
      data-testid="toast-viewport"
      className="toast-viewport pointer-events-none fixed bottom-20 right-4 z-[70] flex max-h-[calc(100svh-6rem)] w-[min(380px,calc(100vw-2rem))] flex-col gap-2.5 sm:right-6 lg:bottom-6"
    >
      {toasts.map((t) => {
        const isError = t.tone === "error";
        const isSuccess = t.tone === "success";
        return (
          <div
            key={t.id}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            aria-atomic="true"
            data-toast-tone={t.tone}
            onMouseEnter={() => store?.pauseTimer(t.id)}
            onMouseLeave={() => store?.resumeTimer(t.id)}
            className="toast-in pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-3 text-[13px] shadow-xl backdrop-blur-sm"
            style={
              isError
                ? {
                    background: "var(--danger-surface)",
                    borderColor: "var(--danger-border)",
                    color: "var(--danger-ink)",
                  }
                : {
                    background: "var(--deck)",
                    borderColor: isSuccess ? tint(C.verify, 40) : "rgb(var(--line)/.25)",
                    color: "var(--ink)",
                  }
            }
          >
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {isError ? (
                <AlertCircle size={16} style={{ color: "var(--danger)" }} />
              ) : isSuccess ? (
                <CheckCircle2 size={16} style={{ color: C.verify }} />
              ) : (
                <Info size={16} style={{ color: C.nox }} />
              )}
            </span>

            <div className="min-w-0 flex-1 leading-snug">
              <p className="font-semibold">{t.title}</p>
              {t.description && (
                <p
                  className="mt-1 break-words text-[12.5px]"
                  style={{ color: isError ? "var(--danger-muted)" : "var(--ink-muted)" }}
                >
                  {t.description}
                </p>
              )}
              {t.suggestion && (
                <p
                  className="mt-1 text-[12px]"
                  style={{ color: isError ? "var(--danger-muted)" : "var(--ink-faint)" }}
                >
                  {t.suggestion}
                </p>
              )}
            </div>

            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => store?.dismiss(t.id)}
              className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm opacity-75 transition-opacity hover:opacity-100"
              style={{ color: isError ? "var(--danger-ink)" : "var(--ink-muted)" }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </section>
  );
}

export function useToast(): ToastFn {
  const store = useContext(ToastStoreContext);
  return store?.push ?? FALLBACK_TOAST_FN;
}
