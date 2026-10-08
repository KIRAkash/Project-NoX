"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { api, API_URL } from "@/lib/app/api";
import type { MediaCapture } from "@/lib/app/types";

export type PlayerHandle = { seek: (t: number) => void };

type Urls = { url: string; captionsUrl: string };

const abs = (u: string) => (u.startsWith("/") ? `${API_URL}${u}` : u);

/**
 * The capture itself: `<video>`, `<audio>` or `<img>`, loaded from a short-lived URL the API hands out after its
 * auth check (media elements can't send headers). Captions come from NoX's transcript. `seek(t)` jumps and plays.
 */
export const MediaPlayer = forwardRef<PlayerHandle, { capture: MediaCapture; className?: string }>(function MediaPlayer({ capture, className = "" }, ref) {
  const [urls, setUrls] = useState<Urls | null>(null);
  const [failed, setFailed] = useState(false);
  const el = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const pending = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setUrls(await api<Urls>(`/api/v1/media/${capture.id}/url`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [capture.id]);

  useEffect(() => {
    if (capture.status !== "uploading") void load();
  }, [load, capture.status]);

  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      const m = el.current;
      if (!m) return;
      if (m.readyState < 1) {
        pending.current = t;
        return;
      }
      m.currentTime = t;
      void m.play().catch(() => undefined);
      m.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  }));

  if (failed) return <p className="text-[12.5px] text-ink-faint">The recording can&rsquo;t be played right now.</p>;
  if (!urls) return <div className={`aspect-video w-full animate-pulse rounded-sm bg-[rgb(var(--line)/.06)] ${className}`} aria-hidden />;
  const isImage = capture.kind === "image" || capture.kind === "screenshot";
  if (isImage) {
    // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL: next/image can't optimise it
    return <img src={abs(urls.url)} alt={capture.caption || capture.summary || capture.label} className={`max-h-[420px] w-full rounded-sm border border-hairline object-contain ${className}`} />;
  }
  const common = {
    ref: el,
    controls: true,
    preload: "metadata" as const,
    src: abs(urls.url),
    onError: () => void load(), // the URL expired: fetch a fresh one
    onLoadedMetadata: () => {
      if (pending.current !== null && el.current) {
        el.current.currentTime = pending.current;
        pending.current = null;
        void el.current.play().catch(() => undefined);
      }
    },
  };
  const track = capture.hasCaptions ? <track kind="captions" src={abs(urls.captionsUrl)} srcLang="en" label="NoX transcript" default /> : null;
  return capture.kind === "audio" ? (
    <audio {...common} className={`w-full ${className}`}>
      {track}
    </audio>
  ) : (
    <video {...common} playsInline className={`max-h-[420px] w-full rounded-sm border border-hairline bg-void ${className}`}>
      {track}
    </video>
  );
});
