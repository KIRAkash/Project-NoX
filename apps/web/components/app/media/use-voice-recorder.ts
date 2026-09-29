"use client";

/** A voice note: the mic only, with an analyser node feeding a small waveform while it records. */

import { useCallback, useEffect, useRef, useState } from "react";

import { AUDIO_TYPES, pickType, type Recording } from "./use-screen-recorder";

export function useVoiceRecorder(maxS = 300) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [result, setResult] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const raf = useRef(0);
  const started = useRef(0);
  const discarding = useRef(false);

  const release = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
  }, []);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    discarding.current = false;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = mic;
      const audio = new AudioContext();
      ctx.current = audio;
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(mic).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const mime = pickType(AUDIO_TYPES);
      const r = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined);
      rec.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const durationS = (performance.now() - started.current) / 1000;
        release();
        setRecording(false);
        if (discarding.current) return;
        const blob = new Blob(chunks, { type: (r.mimeType || mime || "audio/webm").split(";")[0] });
        setResult({ blob, url: URL.createObjectURL(blob), durationS, mime: blob.type, width: null, height: null });
      };
      started.current = performance.now();
      r.start(1000);
      setRecording(true);
      setLevels([]);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevels((l) => [...l.slice(-47), peak]);
        const s = (performance.now() - started.current) / 1000;
        setElapsed(s);
        if (s >= maxS) stop();
        else raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch {
      release();
      setError("NoX couldn't use your microphone.");
    }
  }, [maxS, release, stop]);

  const discard = useCallback(() => {
    discarding.current = true;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    release();
    setRecording(false);
    setResult((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }, [release]);

  useEffect(() => () => {
    discarding.current = true;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    release();
  }, [release]);

  return { recording, elapsed, levels, result, error, start, stop, discard, maxS };
}
