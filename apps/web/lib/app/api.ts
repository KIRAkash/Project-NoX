/** Thin client for the NoX API: attaches the signed-in user's credential and acting role. */

import { dispatchApiErrorToast } from "./toast";

// Empty = same origin: requests go through the /api/v1 rewrite in next.config.mjs.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  toastDispatched = false;

  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export type ApiRequestInit = RequestInit & {
  json?: unknown;
  /** Skip automatic global error toast dispatch for this request. */
  suppressToast?: boolean;
  /** Force error toast dispatch on any non-2xx response (including 4xx). */
  toastOnError?: boolean;
  /** Optional custom title when dispatching an error toast. */
  errorTitle?: string;
  /** Optional custom retry suggestion when dispatching an error toast. */
  retrySuggestion?: string;
};

type Credential = { header: string } | null;

let credentialSource: () => Promise<Credential> = async () => null;
let roleSource: () => string | null = () => null;

/** Wired up once by AuthProvider. */
export function configureApi(opts: { credential: () => Promise<Credential>; role: () => string | null }) {
  credentialSource = opts.credential;
  roleSource = opts.role;
}

/** Authorization + role headers for requests made outside `api()` (e.g. streaming). */
export async function authHeaders(): Promise<Headers> {
  const headers = new Headers();
  const cred = await credentialSource();
  if (cred) headers.set("Authorization", cred.header);
  const role = roleSource();
  if (role) headers.set("X-Nox-Role", role);
  return headers;
}

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { name?: string }).name === "AbortError");
}

function extractNetworkDetail(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const msg = err.message.trim();
  if (!msg || /^(failed to fetch|load failed|networkerror.*|fetch failed)$/i.test(msg)) {
    return undefined;
  }
  return msg;
}

export async function api<T = unknown>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const {
    json,
    suppressToast = false,
    toastOnError = false,
    errorTitle,
    retrySuggestion,
    ...fetchInit
  } = init;

  const headers = new Headers(fetchInit.headers);
  const cred = await credentialSource();
  if (cred) headers.set("Authorization", cred.header);
  const role = roleSource();
  if (role && !headers.has("X-Nox-Role")) headers.set("X-Nox-Role", role);
  let body = fetchInit.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...fetchInit, headers, body });
  } catch (err) {
    if (isAbortError(err)) throw err;
    const networkDetail = extractNetworkDetail(err);
    const apiErr = new ApiError(0, "Network request failed");
    if (!suppressToast) {
      dispatchApiErrorToast({
        status: 0,
        detail: networkDetail,
        title: errorTitle,
        suggestion: retrySuggestion,
      });
      apiErr.toastDispatched = true;
    }
    throw apiErr;
  }

  if (!res.ok) {
    let detail = res.statusText?.trim() || "";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail.trim()) {
        detail = data.detail.trim();
      } else if (typeof data?.message === "string" && data.message.trim()) {
        detail = data.message.trim();
      } else if (typeof data?.error === "string" && data.error.trim()) {
        detail = data.error.trim();
      } else if (data?.detail !== undefined) {
        detail = JSON.stringify(data.detail);
      } else if (data !== undefined) {
        detail = JSON.stringify(data);
      }
    } catch {
      /* not JSON */
    }
    if (!detail) {
      detail = `HTTP ${res.status}`;
    }

    const apiErr = new ApiError(res.status, detail);
    const shouldDispatchToast =
      !suppressToast && (toastOnError || res.status >= 500 || res.status === 408 || res.status === 429);

    if (shouldDispatchToast) {
      dispatchApiErrorToast({
        status: res.status,
        detail,
        title: errorTitle,
        suggestion: retrySuggestion,
      });
      apiErr.toastDispatched = true;
    }
    throw apiErr;
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
