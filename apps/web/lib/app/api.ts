/** Thin client for the NoX API: attaches the signed-in user's credential and acting role. */

// Empty = same origin: requests go through the /api/v1 rewrite in next.config.mjs.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
  }
}

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

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const cred = await credentialSource();
  if (cred) headers.set("Authorization", cred.header);
  const role = roleSource();
  if (role && !headers.has("X-Nox-Role")) headers.set("X-Nox-Role", role);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
