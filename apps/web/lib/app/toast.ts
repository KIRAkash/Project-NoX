/**
 * Global client toast event bus with 3-second duplicate error throttling.
 * Allows non-React modules (such as `api.ts`) and React hooks (`use-api.ts`, `useToast`)
 * to dispatch structured notifications to the root `ToastViewport`.
 */

export type ToastTone = "info" | "success" | "error";

export interface ToastInput {
  id?: string;
  tone?: ToastTone;
  title: string;
  description?: string;
  suggestion?: string;
  durationMs?: number;
  dedupeKey?: string;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  suggestion?: string;
  durationMs: number;
  createdAt: number;
}

export const DEFAULT_TOAST_DURATION_MS = 5000;
export const ERROR_THROTTLE_WINDOW_MS = 3000;

type ToastListener = (toast: ToastItem) => void;

const listeners = new Set<ToastListener>();
const pendingQueue: ToastItem[] = [];
const recentErrorTimestamps = new Map<string, number>();

let toastSeq = 0;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasRetryHint(text: string): boolean {
  return /\b(try again|retry|reload|refresh|check your connection)\b/i.test(text);
}

function pruneThrottleWindow(now: number): void {
  for (const [key, timestamp] of recentErrorTimestamps.entries()) {
    if (now - timestamp >= ERROR_THROTTLE_WINDOW_MS) {
      recentErrorTimestamps.delete(key);
    }
  }
}

/**
 * Checks whether an error toast matches a recently emitted error within the 3-second window,
 * and records its fingerprints when allowed through.
 */
function shouldThrottleError(input: ToastInput, now: number): boolean {
  pruneThrottleWindow(now);

  const normTitle = normalizeKey(input.title);
  const normDesc = input.description ? normalizeKey(input.description) : "";
  const primaryKey = input.dedupeKey ? normalizeKey(input.dedupeKey) : `${normTitle}::${normDesc}`;

  const lastPrimary = recentErrorTimestamps.get(primaryKey);
  if (lastPrimary !== undefined && now - lastPrimary < ERROR_THROTTLE_WINDOW_MS) {
    return true;
  }

  // Also suppress bare follow-up `toast(err.detail, "error")` calls when `api()` already
  // dispatched a structured toast carrying that exact detail or title moments earlier.
  if (!normDesc) {
    const matchingDetailTs = recentErrorTimestamps.get(`detail::${normTitle}`);
    if (matchingDetailTs !== undefined && now - matchingDetailTs < ERROR_THROTTLE_WINDOW_MS) {
      return true;
    }
    const matchingTitleTs = recentErrorTimestamps.get(`title::${normTitle}`);
    if (matchingTitleTs !== undefined && now - matchingTitleTs < ERROR_THROTTLE_WINDOW_MS) {
      return true;
    }
  }

  recentErrorTimestamps.set(primaryKey, now);
  if (normTitle) {
    recentErrorTimestamps.set(`title::${normTitle}`, now);
  }
  if (normDesc) {
    recentErrorTimestamps.set(`detail::${normDesc}`, now);
  }
  return false;
}

export function subscribeToastBus(listener: ToastListener): () => void {
  listeners.add(listener);
  if (pendingQueue.length > 0) {
    const now = Date.now();
    const queued = pendingQueue.splice(0, pendingQueue.length);
    for (const item of queued) {
      if (now - item.createdAt < item.durationMs) {
        listener(item);
      }
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Dispatches a toast event to the global bus.
 * Returns the created toast ID, or `null` if throttled or called during SSR.
 */
export function dispatchToast(input: ToastInput): string | null {
  const title = input.title.trim();
  if (!title) return null;

  const tone: ToastTone = input.tone ?? "info";
  const now = Date.now();

  const rawDesc = input.description?.trim();
  const description = rawDesc && normalizeKey(rawDesc) !== normalizeKey(title) ? rawDesc : undefined;

  if (tone === "error" && shouldThrottleError({ ...input, title, description }, now)) {
    return null;
  }

  let suggestion = input.suggestion?.trim();
  if (tone === "error" && suggestion === undefined) {
    const combined = `${title} ${description ?? ""}`;
    if (!hasRetryHint(combined)) {
      suggestion = "Please try again.";
    }
  }

  toastSeq += 1;
  const item: ToastItem = {
    id: input.id ?? `nox-toast-${now}-${toastSeq}`,
    tone,
    title,
    description,
    suggestion: suggestion || undefined,
    durationMs: input.durationMs ?? DEFAULT_TOAST_DURATION_MS,
    createdAt: now,
  };

  if (listeners.size === 0) {
    if (typeof window !== "undefined") {
      pendingQueue.push(item);
      if (pendingQueue.length > 10) pendingQueue.shift();
    }
    return item.id;
  }

  for (const listener of listeners) {
    listener(item);
  }
  return item.id;
}

export function defaultTitleForStatus(status: number): string {
  if (status === 0) return "Network request failed";
  if (status === 408) return "Request timed out";
  if (status === 429) return "Too many requests";
  if (status === 502 || status === 503 || status === 504) return "Service temporarily unavailable";
  if (status >= 500) return "Server error";
  if (status === 401) return "Authentication required";
  if (status === 403) return "Access denied";
  if (status === 404) return "Resource not found";
  return "Request failed";
}

export function defaultSuggestionForStatus(status: number): string {
  if (status === 0 || status === 408) return "Check your connection and try again.";
  if (status === 429) return "Wait a few seconds and try again.";
  if (status === 502 || status === 503 || status === 504) {
    return "The server may be restarting. Wait a moment and try again.";
  }
  if (status >= 500) return "Wait a moment and try again.";
  if (status === 401) return "Sign in again and retry.";
  return "Review the details and try again.";
}

export interface ApiErrorToastOptions {
  status: number;
  detail?: string;
  title?: string;
  suggestion?: string;
  dedupeKey?: string;
}

export function formatApiErrorToast(opts: ApiErrorToastOptions): ToastInput {
  const title = opts.title?.trim() || defaultTitleForStatus(opts.status);
  const trimmedDetail = opts.detail?.trim();
  const fallbackDetail =
    opts.status === 0
      ? "Unable to reach NoX right now."
      : opts.status >= 500
        ? `Unexpected server response (HTTP ${opts.status}).`
        : undefined;

  const description =
    trimmedDetail && normalizeKey(trimmedDetail) !== normalizeKey(title)
      ? trimmedDetail
      : fallbackDetail;

  return {
    tone: "error",
    title,
    description,
    suggestion: opts.suggestion?.trim() || defaultSuggestionForStatus(opts.status),
    dedupeKey: opts.dedupeKey,
  };
}

export function dispatchApiErrorToast(opts: ApiErrorToastOptions): string | null {
  return dispatchToast(formatApiErrorToast(opts));
}

/** Test utility to clear queued items and throttle timestamps between test runs. */
export function resetToastBusForTests(): void {
  pendingQueue.length = 0;
  recentErrorTimestamps.clear();
}
