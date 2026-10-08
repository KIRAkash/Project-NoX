"use client";

/**
 * Voice (CP20). `VoiceInput` is a mic button for any NoX text box: click to talk, click to stop (Esc cancels), and
 * the words stream into the box for the person to edit and send as usual. NoX never sends anything by itself.
 * `ListenButton` reads one of NoX's replies aloud, only when clicked. Both hide where voice isn't available
 * (NoX Local, or no speech model configured).
 */

import { Loader2, Mic, Square, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useVoiceRecorder } from "@/components/app/media/use-voice-recorder";
import { useToast } from "@/components/app/ui";
import { api, API_URL, authHeaders } from "@/lib/app/api";
import { streamPost } from "@/lib/app/stream";

type VoiceStatus = { speak: boolean; listen: boolean; maxSeconds: number };

let statusPromise: Promise<VoiceStatus> | null = null;

export function useVoiceStatus(): VoiceStatus | null {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    statusPromise ??= api<VoiceStatus>("/api/v1/voice/status").catch(() => {
      statusPromise = null; // try again next time a box mounts
      return { speak: false, listen: false, maxSeconds: 120 };
    });
    let live = true;
    void statusPromise.then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return status;
}

const join = (before: string, spoken: string) => (before && spoken ? `${before.replace(/\s+$/, "")} ${spoken}` : before + spoken);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav" };

/** A mic button that writes what the person says into `value` (appended to what's there). */
export function VoiceInput({ value, onChange, label, className = "" }: { value: string; onChange: (v: string) => void; label?: string; className?: string }) {
  const status = useVoiceStatus();
  const toast = useToast();
  const rec = useVoiceRecorder(status?.maxSeconds ?? 120);
  const [hearing, setHearing] = useState(false);
  const [english, setEnglish] = useState<{ before: string; english: string; language: string } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const before = useRef("");
  const abort = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    setEnglish(null);
    before.current = valueRef.current;
    void rec.start();
  }, [rec]);

  // A finished recording goes to NoX; the words stream into the box.
  const { result, discard } = rec;
  useEffect(() => {
    if (!result) return;
    const form = new FormData();
    const mime = result.mime || "audio/webm";
    form.append("audio", new File([result.blob], `voice.${EXT[mime] ?? "webm"}`, { type: mime }));
    const ctrl = new AbortController();
    abort.current = ctrl;
    setHearing(true);
    let spoken = "";
    void streamPost(
      "/api/v1/voice/transcribe",
      form,
      ({ event, data }) => {
        const d = data as { text?: string; english?: string | null; language?: string | null; message?: string };
        if (event === "delta" && d.text) {
          spoken += d.text;
          onChangeRef.current(join(before.current, spoken.trim()));
        } else if (event === "done") {
          onChangeRef.current(join(before.current, (d.text ?? spoken).trim()));
          if (d.english && d.language) setEnglish({ before: before.current, english: d.english, language: d.language });
          if (!(d.text ?? spoken).trim()) toast("NoX didn't hear any words. Try again a little closer to the mic", "error");
        } else if (event === "error") {
          toast(d.message ?? "NoX couldn't hear that", "error");
        }
      },
      ctrl.signal,
    )
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) toast(e instanceof Error ? e.message : "NoX couldn't hear that", "error");
      })
      .finally(() => {
        setHearing(false);
        discard(); // the recording is not kept anywhere
      });
    return () => ctrl.abort();
  }, [result, discard, toast]); // one upload per finished recording

  const { recording } = rec;
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && discard();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, discard]);

  useEffect(() => {
    if (rec.error) toast(rec.error, "error");
  }, [rec.error, toast]);

  if (!status?.speak) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      {rec.recording ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(233,113,60,.5)] py-0.5 pl-1 pr-2 text-[12px] text-[color:var(--coral-ink)]">
          <button type="button" onClick={rec.stop} aria-label="Stop and write it down" className="flex h-6 w-6 items-center justify-center rounded-full bg-ember text-void">
            <Square size={10} fill="currentColor" aria-hidden />
          </button>
          <span className="flex h-4 items-end gap-[2px]" aria-hidden>
            {rec.levels.slice(-14).map((l, i) => (
              <span key={i} className="w-[2px] rounded-full bg-[color:var(--coral)]" style={{ height: `${Math.max(2, Math.min(16, l * 40))}px` }} />
            ))}
          </span>
          <span className="font-mono tabular-nums">{fmt(rec.elapsed)}</span>
          <button type="button" onClick={rec.discard} aria-label="Cancel recording" className="text-ink-dim hover:text-ink">
            <X size={12} />
          </button>
        </span>
      ) : hearing ? (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint" role="status">
          <Loader2 size={13} className="animate-spin" aria-hidden /> Writing it down…
        </span>
      ) : (
        <>
        {label && <span className="text-[12.5px] text-ink-faint">{label}</span>}
        <button
          type="button"
          onClick={start}
          aria-label="Speak instead of typing"
          title="Speak instead of typing"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-ink-dim hover:border-[color:var(--role)] hover:text-[color:var(--role)]"
        >
          <Mic size={14} aria-hidden />
        </button>
        </>
      )}
      {english && !rec.recording && !hearing && (
        <button
          type="button"
          onClick={() => {
            onChange(join(english.before, english.english));
            setEnglish(null);
          }}
          className="rounded-full border border-hairline px-2 py-0.5 text-[11.5px] text-ink-muted hover:text-ink"
          title={`You spoke ${english.language}. NoX can put it in English instead.`}
        >
          Use English
        </button>
      )}
    </span>
  );
}

/** Read one of NoX's replies aloud. Never plays by itself; a second click stops it. */
export function ListenButton({ text, className = "" }: { text: string; className?: string }) {
  const status = useVoiceStatus();
  const toast = useToast();
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    audio.current?.pause();
    if (audio.current?.src) URL.revokeObjectURL(audio.current.src);
  }, []);

  if (!status?.listen || !text.trim()) return null;

  const play = async () => {
    if (state === "playing" || state === "loading") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const headers = await authHeaders();
      headers.set("Content-Type", "application/json");
      const res = await fetch(`${API_URL}/api/v1/voice/speak`, { method: "POST", headers, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "NoX couldn't speak just now");
      const url = URL.createObjectURL(await res.blob());
      if (audio.current?.src) URL.revokeObjectURL(audio.current.src);
      const a = new Audio(url);
      audio.current = a;
      a.onended = () => setState("idle");
      await a.play();
      setState("playing");
    } catch (e) {
      setState("idle");
      toast(e instanceof Error ? e.message : "NoX couldn't speak just now", "error");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void play()}
      aria-label={state === "playing" ? "Stop reading aloud" : "Read aloud"}
      aria-pressed={state === "playing"}
      className={`inline-flex items-center gap-1 text-[11.5px] text-ink-dim hover:text-ink ${className}`}
    >
      {state === "loading" ? <Loader2 size={12} className="animate-spin" aria-hidden /> : state === "playing" ? <Square size={11} aria-hidden /> : <Volume2 size={12} aria-hidden />}
      {state === "playing" ? "Stop" : "Listen"}
    </button>
  );
}
