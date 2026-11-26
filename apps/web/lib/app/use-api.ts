"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError } from "./api";
import { dispatchApiErrorToast, dispatchToast, type ToastInput } from "./toast";

export interface UseApiOptions {
  /** Custom error title/message to display in a toast alert when the request fails. */
  errorMessage?: string | ((error: ApiError) => string);
  /** Custom retry suggestion displayed in the error toast banner. */
  retrySuggestion?: string;
  /**
   * Controls automatic error toast alerts for this hook:
   * - `true`: toast on any request failure (including 4xx)
   * - `false`: suppress automatic error toasts for this hook
   * - `undefined` (default): toast on network/5xx errors, or on any error when `errorMessage` is provided
   */
  toastOnError?: boolean;
}

/** Imperative helper to dispatch an actionable error toast alert from an ApiError or unknown exception. */
export function toastApiError(
  error: unknown,
  customMessage?: string,
  retrySuggestion?: string,
): string | null {
  if (error instanceof ApiError) {
    error.toastDispatched = true;
    return dispatchApiErrorToast({
      status: error.status,
      detail: error.detail,
      title: customMessage,
      suggestion: retrySuggestion,
    });
  }
  const detail = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
  return dispatchApiErrorToast({
    status: 0,
    detail,
    title: customMessage || detail || "Something went wrong",
    suggestion: retrySuggestion,
  });
}

/** React hook exposing toast alert helpers for custom error and status messages alongside API workflows. */
export function useApiToast() {
  const toastError = useCallback(
    (message: string, options?: { detail?: string; suggestion?: string; error?: unknown }) => {
      if (options?.error !== undefined) {
        return toastApiError(options.error, message, options.suggestion);
      }
      return dispatchToast({
        tone: "error",
        title: message,
        description: options?.detail,
        suggestion: options?.suggestion,
      });
    },
    [],
  );

  const toastAlert = useCallback((input: ToastInput) => dispatchToast(input), []);

  return useMemo(() => ({ toastError, toastAlert, toastApiError }), [toastError, toastAlert]);
}

/** Fetch an API path on mount (and on `reload`). `path = null` skips the request. */
export function useApi<T>(path: string | null, options?: UseApiOptions) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const errorRef = useRef<ApiError | null>(null);
  errorRef.current = error;

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    const opts = optionsRef.current;
    const hasCustomHandler = opts?.errorMessage !== undefined || opts?.toastOnError === true;
    const suppressInClient = opts?.toastOnError === false || hasCustomHandler;

    try {
      setData(await api<T>(path, { suppressToast: suppressInClient }));
      setError(null);
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : new ApiError(0, String(e));
      setError(apiErr);
      if (opts?.toastOnError !== false && hasCustomHandler) {
        const customTitle =
          typeof opts?.errorMessage === "function" ? opts.errorMessage(apiErr) : opts?.errorMessage;
        toastApiError(apiErr, customTitle, opts?.retrySuggestion);
      }
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const toastError = useCallback(
    (customMessage?: string, retrySuggestion?: string) => {
      const currentErr = errorRef.current;
      if (currentErr) {
        return toastApiError(currentErr, customMessage, retrySuggestion);
      }
      return dispatchToast({
        tone: "error",
        title: customMessage || "Request failed",
        suggestion: retrySuggestion,
      });
    },
    [],
  );

  return { data, error, loading, reload: load, toastError };
}
