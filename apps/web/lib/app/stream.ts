/**
 * Server-sent events over fetch, so the request can carry the Authorization header
 * (EventSource can't). Reconnects with backoff until the caller aborts.
 */

import { API_URL, authHeaders } from "./api";

export type StreamEvent = { event: string; data: unknown };

export function subscribe(path: string, onEvent: (e: StreamEvent) => void): () => void {
  const controller = new AbortController();
  let attempt = 0;

  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders(), signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        attempt = 0;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            let event = "message";
            const data: string[] = [];
            for (const line of frame.split(/\r?\n/)) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            }
            if (!data.length) continue; // comments / pings
            const raw = data.join("\n");
            let parsed: unknown = raw;
            try {
              parsed = JSON.parse(raw);
            } catch {
              /* plain text */
            }
            onEvent({ event, data: parsed });
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** attempt)));
    }
  };

  void run();
  return () => controller.abort();
}

/**
 * One request, streamed back: POST `body`, call `onEvent` for each SSE frame until the server ends it.
 * No reconnects (the request isn't idempotent). Resolves when the stream closes; `abort()` stops it early.
 */
export async function streamPost(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = await authHeaders();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let detail = `Request failed (${res.status})`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      const raw = data.join("\n");
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* plain text */
      }
      onEvent({ event, data: parsed });
    }
  }
}
