"use client";

import { Camera, Mic, MonitorPlay, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/app/ui";
import { ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID } from "@/lib/app/roles";
import { fmtT, type MediaCapture, type MediaKind } from "@/lib/app/types";

import { Annotator } from "./annotator";
import { RecordingPill } from "./recording-pill";
import { imageSize, mediaDuration, normaliseImage, uploadCapture } from "./upload";
import { canCaptureScreen, canRecordAudio, grabScreenshot, useScreenRecorder } from "./use-screen-recorder";
import { useVoiceRecorder } from "./use-voice-recorder";

type Pending = { blob: Blob; url: string; kind: MediaKind; durationS: number | null; width: number | null; height: number | null };
type Sheet =
  | { mode: "setup" }
  | { mode: "voice" }
  | { mode: "preview"; item: Pending }
  | { mode: "annotate"; item: Pending }
  | { mode: "uploading"; share: number; label: string };

const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif";
const VIDEO_TYPES = "video/mp4,video/webm,video/quicktime";
const AUDIO_TYPES = "audio/mp4,audio/x-m4a,audio/mpeg,audio/webm,audio/wav,audio/ogg";

/**
 * Show NoX: record the screen, take a screenshot, leave a voice note or upload a file. Drag-and-drop and paste work
 * anywhere on the page when `global` is set. Screen capture is hidden where the browser can't do it (phones), and
 * video and voice are hidden on NoX Local, which reads images only. Every capture is uploaded, then handed to
 * `onMedia`; an annotated screenshot hands over the marked-up copy, whose `annotatedOf` is the original.
 */
export function CaptureBar({
  missionKey,
  role,
  onMedia,
  global = false,
  compact = false,
}: {
  missionKey?: string;
  role?: string;
  onMedia: (capture: MediaCapture, extraIds?: string[]) => void;
  global?: boolean;
  compact?: boolean;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const hue = ROLE_BY_ID[me!.role!].hue;
  const local = me?.aiBackend === "local";
  const [screenOk, setScreenOk] = useState(false);
  const [micOk, setMicOk] = useState(false);
  useEffect(() => {
    setScreenOk(canCaptureScreen());
    setMicOk(canRecordAudio());
  }, []);
  const rec = useScreenRecorder(180);
  const voice = useVoiceRecorder(300);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [tabAudio, setTabAudio] = useState(false);
  const [caption, setCaption] = useState("");
  const file = useRef<HTMLInputElement>(null);

  // A finished recording or voice note opens the preview.
  useEffect(() => {
    if (rec.state === "stopped" && rec.result) setSheet({ mode: "preview", item: { ...rec.result, kind: "screen_recording" } });
  }, [rec.state, rec.result]);
  useEffect(() => {
    if (voice.result) setSheet({ mode: "preview", item: { ...voice.result, kind: "audio" } });
  }, [voice.result]);
  useEffect(() => {
    if (rec.error) toast(rec.error, "error");
  }, [rec.error, toast]);

  const upload = useCallback(
    async (item: Pending, annotatedOf?: string) => {
      const label = { screen_recording: "recording", audio: "voice note", video: "video", screenshot: "screenshot", image: "image" }[item.kind];
      setSheet({ mode: "uploading", share: 0, label });
      try {
        const capture = await uploadCapture(
          item.blob,
          { kind: item.kind, durationS: item.durationS, width: item.width, height: item.height, caption: caption.trim() || null, annotatedOf, missionKey, role },
          (share) => setSheet({ mode: "uploading", share, label }),
        );
        setCaption("");
        return capture;
      } catch (e) {
        toast(e instanceof ApiError ? e.detail : "The upload didn't go through", "error");
        return null;
      } finally {
        setSheet(null);
      }
    },
    [caption, missionKey, role, toast],
  );

  const sendItem = async (item: Pending) => {
    const capture = await upload(item);
    rec.reset();
    if (capture) onMedia(capture);
  };

  const sendImage = async (item: Pending, marked: Blob | null) => {
    const original = await upload(item);
    if (!original) return;
    if (!marked) return onMedia(original);
    const size = await imageSize(marked);
    const copy = await upload({ ...item, blob: marked, url: "", width: size?.width ?? item.width, height: size?.height ?? item.height }, original.id);
    onMedia(copy ?? original, copy ? [original.id] : []);
  };

  const takeFile = useCallback(
    async (f: File) => {
      if (f.type.startsWith("image/")) {
        const blob = await normaliseImage(f);
        const size = await imageSize(blob);
        setSheet({ mode: "annotate", item: { blob, url: URL.createObjectURL(blob), kind: "image", durationS: null, width: size?.width ?? null, height: size?.height ?? null } });
      } else if (!local && (f.type.startsWith("video/") || f.type.startsWith("audio/"))) {
        const kind: MediaKind = f.type.startsWith("audio/") ? "audio" : "video";
        setSheet({ mode: "preview", item: { blob: f, url: URL.createObjectURL(f), kind, durationS: await mediaDuration(f), width: null, height: null } });
      } else {
        toast(local ? "NoX Local reads images only — video needs NoX in the cloud" : "NoX takes images, video and audio", "error");
      }
    },
    [local, toast],
  );

  const screenshot = async () => {
    try {
      const shot = await grabScreenshot();
      setSheet({ mode: "annotate", item: { blob: shot.blob, url: URL.createObjectURL(shot.blob), kind: "screenshot", durationS: null, width: shot.width, height: shot.height } });
    } catch {
      /* the user closed the share picker */
    }
  };

  // Paste an image, or drop a file, anywhere on the page.
  useEffect(() => {
    if (!global) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        void takeFile(item);
      }
    };
    const onDrag = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && e.preventDefault();
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        e.preventDefault();
        void takeFile(f);
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDrag);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDrag);
      window.removeEventListener("drop", onDrop);
    };
  }, [global, takeFile]);

  const btn = `flex items-center gap-1.5 rounded-sm border border-hairline text-ink-muted hover:border-ink-faint hover:text-ink disabled:opacity-40 ${compact ? "h-8 px-2.5 text-[12px]" : "h-9 px-3 text-[13px]"}`;
  const cloudOnly = local ? "Video needs NoX in the cloud" : undefined;
  const busy = !!sheet || rec.state !== "idle" && rec.state !== "stopped" || voice.recording;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show NoX">
        {!compact && <span className="mr-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--role)]">Show NoX</span>}
        {screenOk && !local && (
          <button type="button" disabled={busy} onClick={() => setSheet({ mode: "setup" })} className={btn}>
            <MonitorPlay size={14} /> Record screen
          </button>
        )}
        {screenOk && (
          <button type="button" disabled={busy} onClick={() => void screenshot()} className={btn}>
            <Camera size={14} /> Take screenshot
          </button>
        )}
        {micOk && !local && (
          <button type="button" disabled={busy} onClick={() => setSheet({ mode: "voice" })} className={btn}>
            <Mic size={14} /> Voice note
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => file.current?.click()} className={btn} title={cloudOnly}>
          <Upload size={14} /> Upload
        </button>
        <input
          ref={file}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload an image, video or audio file"
          accept={local ? IMAGE_TYPES : `${IMAGE_TYPES},${VIDEO_TYPES},${AUDIO_TYPES},image/*,video/*`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void takeFile(f);
          }}
        />
        {!compact && global && <span className="text-[12px] text-ink-faint">or paste / drop a file</span>}
        {local && !compact && <span className="text-[12px] text-ink-faint">{cloudOnly}</span>}
      </div>

      {sheet?.mode === "setup" && (
        <div className="rounded-md border border-hairline bg-deck p-4 text-[13px]">
          <p className="text-ink">NoX will see what you share. Close anything private first.</p>
          <div className="mt-3 flex flex-wrap gap-4 text-ink-muted">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} style={{ accentColor: hue }} /> Include my voice
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={tabAudio} onChange={(e) => setTabAudio(e.target.checked)} style={{ accentColor: hue }} /> Include tab audio
            </label>
          </div>
          <p className="mt-2 text-[12px] text-ink-faint">Up to 3 minutes. Narrate what you expected and what happened.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setSheet(null)} className="h-9 px-3 text-ink-dim hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setSheet(null);
                void rec.start({ voice: voiceOn, tabAudio });
              }}
              className="h-9 rounded-sm px-4 font-semibold text-abyss"
              style={{ background: hue }}
            >
              Choose what to share
            </button>
          </div>
        </div>
      )}

      {sheet?.mode === "voice" && (
        <div className="rounded-md border border-hairline bg-deck p-4 text-[13px]">
          <div className="flex h-10 items-center gap-[3px]" aria-hidden>
            {Array.from({ length: 48 }, (_, i) => voice.levels[i - (48 - voice.levels.length)] ?? 0).map((v, i) => (
              <span key={i} className="w-[3px] rounded-full" style={{ height: `${Math.max(6, v * 100)}%`, background: voice.recording ? hue : "rgb(var(--line)/.25)" }} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-ink-muted" aria-live="polite">
              {fmtT(voice.elapsed)} / {fmtT(voice.maxS)}
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={() => { voice.discard(); setSheet(null); }} className="h-9 px-3 text-ink-dim hover:text-ink">
                Cancel
              </button>
              {voice.recording ? (
                <button type="button" onClick={voice.stop} className="h-9 rounded-sm bg-ember px-4 font-semibold text-abyss">
                  Stop
                </button>
              ) : (
                <button type="button" onClick={() => void voice.start()} className="h-9 rounded-sm px-4 font-semibold text-abyss" style={{ background: hue }}>
                  Start recording
                </button>
              )}
            </span>
          </div>
          {voice.error && <p className="mt-2 text-[12.5px] text-[color:var(--coral-ink)]">{voice.error}</p>}
        </div>
      )}

      {sheet?.mode === "preview" && (
        <div className="space-y-3 rounded-md border border-hairline bg-deck p-4 text-[13px]">
          {sheet.item.kind === "audio" ? (
            <audio src={sheet.item.url} controls className="w-full" />
          ) : (
            <video src={sheet.item.url} controls playsInline className="max-h-[320px] w-full rounded-sm bg-void" />
          )}
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
            placeholder="What should NoX look at? (optional)"
            aria-label="What should NoX look at?"
            className="h-9 w-full rounded-sm border border-hairline bg-void px-3 text-ink outline-none focus:border-[color:var(--role)]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(sheet.item.url);
                rec.reset();
                voice.discard();
                setSheet(sheet.item.kind === "screen_recording" ? { mode: "setup" } : sheet.item.kind === "audio" ? { mode: "voice" } : null);
              }}
              className="h-9 rounded-sm border border-hairline px-3 text-ink-muted hover:text-ink"
            >
              {sheet.item.kind === "video" ? "Cancel" : "Retake"}
            </button>
            <button type="button" onClick={() => void sendItem(sheet.item)} className="h-9 rounded-sm px-4 font-semibold text-abyss" style={{ background: hue }}>
              Use this
            </button>
          </div>
        </div>
      )}

      {sheet?.mode === "annotate" && (
        <div className="rounded-md border border-hairline bg-deck p-4">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
            placeholder="What should NoX look at? (optional)"
            aria-label="What should NoX look at?"
            className="mb-3 h-9 w-full rounded-sm border border-hairline bg-void px-3 text-[13px] text-ink outline-none focus:border-[color:var(--role)]"
          />
          <Annotator src={sheet.item.url} hue={hue} onCancel={() => setSheet(null)} onDone={(marked) => void sendImage(sheet.item, marked)} />
        </div>
      )}

      {sheet?.mode === "uploading" && (
        <div className="rounded-md border border-hairline bg-deck p-3 text-[12.5px] text-ink-muted" role="status">
          <div className="flex justify-between">
            <span>Uploading your {sheet.label}…</span>
            <span className="font-mono">{Math.round(sheet.share * 100)}%</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgb(var(--line)/.12)]">
            <div className="h-full transition-[width]" style={{ width: `${sheet.share * 100}%`, background: hue }} />
          </div>
        </div>
      )}

      {(rec.state === "countdown" || rec.state === "recording" || rec.state === "paused") && (
        <RecordingPill state={rec.state} countdown={rec.countdown} elapsed={rec.elapsed} maxS={rec.maxS} onPause={rec.pause} onResume={rec.resume} onStop={rec.stop} onDiscard={rec.discard} />
      )}
    </div>
  );
}

/** A small removable chip for a capture that's attached but not yet sent. */
export function CaptureChip({ capture, onRemove }: { capture: MediaCapture; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5 text-[11.5px] text-ink-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${capture.status === "ready" ? "bg-verify" : "animate-pulse bg-[color:var(--violet)]"}`} aria-hidden />
      <span className="truncate">{capture.label}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${capture.label}`} className="text-ink-dim hover:text-ink">
          <X size={11} />
        </button>
      )}
    </span>
  );
}
