"use client";

/**
 * Screen recording in the browser: the share picker (`getDisplayMedia`), the mic mixed in with Web Audio,
 * and `MediaRecorder` in 1 s slices. idle → countdown → recording ⇄ paused → stopped. Every track is stopped
 * on stop, discard and unmount, and stopping the share from the browser's own bar stops the recording too.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type RecState = "idle" | "countdown" | "recording" | "paused" | "stopped";
export type Recording = { blob: Blob; url: string; durationS: number; mime: string; width: number | null; height: number | null };

const VIDEO_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function pickType(types: string[]): string {
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/** Phones can't share their screen from the browser: the capture bar hides these actions there. */
export function canCaptureScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  return !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function canRecordAudio(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** One frame of a shared tab, window or screen, then the share ends. */
export async function grabScreenshot(): Promise<{ blob: Blob; width: number; height: number }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("capture"))), "image/png"));
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function useScreenRecorder(maxS = 180) {
  const [state, setState] = useState<RecState>("idle");
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const clock = useRef({ started: 0, pausedAt: 0, paused: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const size = useRef<{ width: number | null; height: number | null }>({ width: null, height: null });
  const discarding = useRef(false);

  const seconds = () => {
    const c = clock.current;
    const now = c.pausedAt || performance.now();
    return Math.max(0, (now - c.started - c.paused) / 1000);
  };

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  const stop = useCallback(() => {
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
    else release();
  }, [release]);

  const start = useCallback(
    async ({ voice = true, tabAudio = false }: { voice?: boolean; tabAudio?: boolean } = {}) => {
      setError(null);
      setResult(null);
      discarding.current = false;
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 15, width: { max: 1280 }, height: { max: 1280 } },
          audio: tabAudio,
        });
        streams.current = [display];
        let mic: MediaStream | null = null;
        if (voice) {
          try {
            mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            streams.current.push(mic);
          } catch {
            setError("NoX couldn't use your microphone, so this recording has no voice.");
          }
        }
        const audio = [display, mic].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
        const tracks = [...display.getVideoTracks()];
        if (audio.length) {
          const ctx = new AudioContext();
          audioCtx.current = ctx;
          const dest = ctx.createMediaStreamDestination();
          audio.forEach((s) => ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest));
          tracks.push(...dest.stream.getAudioTracks());
        }
        const video = display.getVideoTracks()[0];
        const settings = video.getSettings();
        size.current = { width: settings.width ?? null, height: settings.height ?? null };
        video.addEventListener("ended", () => stop()); // "Stop sharing" in the browser's bar

        const mime = pickType(VIDEO_TYPES);
        const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 1_500_000 } : undefined);
        recorder.current = rec;
        chunks.current = [];
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        rec.onstop = () => {
          const durationS = seconds();
          release();
          if (discarding.current) {
            setState("idle");
            return;
          }
          const blob = new Blob(chunks.current, { type: (rec.mimeType || mime || "video/webm").split(";")[0] });
          setResult({ blob, url: URL.createObjectURL(blob), durationS, mime: blob.type, ...size.current });
          setState("stopped");
        };

        setState("countdown");
        for (let n = 3; n > 0; n--) {
          setCountdown(n);
          await new Promise((r) => setTimeout(r, 1000));
          if (!streams.current.length) return; // cancelled during the countdown
        }
        clock.current = { started: performance.now(), pausedAt: 0, paused: 0 };
        rec.start(1000);
        setState("recording");
        setElapsed(0);
        timer.current = setInterval(() => {
          const s = seconds();
          setElapsed(s);
          if (s >= maxS) stop();
        }, 250);
      } catch (e) {
        release();
        setState("idle");
        if ((e as DOMException)?.name !== "NotAllowedError") setError("Screen recording isn't available in this browser.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seconds() reads refs
    [maxS, release, stop],
  );

  const pause = useCallback(() => {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    clock.current.pausedAt = performance.now();
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (recorder.current?.state !== "paused") return;
    const c = clock.current;
    c.paused += performance.now() - c.pausedAt;
    c.pausedAt = 0;
    recorder.current.resume();
    setState("recording");
  }, []);

  const discard = useCallback(() => {
    discarding.current = true;
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
    else {
      release();
      setState("idle");
    }
    setResult((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }, [release]);

  const reset = useCallback(() => {
    setResult((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
    setState("idle");
  }, []);

  useEffect(() => () => {
    discarding.current = true;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release();
  }, [release]);

  return { state, countdown, elapsed, result, error, start, pause, resume, stop, discard, reset, maxS };
}

export { AUDIO_TYPES };
