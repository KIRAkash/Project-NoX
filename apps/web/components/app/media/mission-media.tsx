"use client";

import { Image as ImageIcon, Mic, MonitorPlay, Video } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

import { subscribe } from "@/lib/app/stream";
import type { MediaCapture, MediaKind, SpecFile } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

import { visibleCaptures } from "./evidence-tab";

export const KIND_ICON: Record<MediaKind, typeof ImageIcon> = { image: ImageIcon, screenshot: ImageIcon, screen_recording: MonitorPlay, video: Video, audio: Mic };

const SEAT: Record<SpecFile["role"], string> = { business: "Business", product: "Product", engineering: "Engineering", developer: "Developer" };

/** "dev (Business)": who added a capture, and from which seat. */
export function addedBy(c: MediaCapture): string {
  return c.uploadedBy ? `${c.uploadedBy} (${SEAT[c.uploadedAs]})` : SEAT[c.uploadedAs];
}

/** Stills are cited whole; recordings and voice notes from a moment. */
export function mediaRef(c: MediaCapture, t = 0): string {
  return c.kind === "image" || c.kind === "screenshot" ? `[[media:${c.id}]]` : `[[media:${c.id}#t=${Math.round(t)}]]`;
}

/**
 * The mission's captures, as the rest of the mission page sees them: the evidence badge on each file, the Evidence
 * panel in the rail, the labels on `[[media:…]]` chips and the editor's "reference evidence" list. One fetch, kept
 * fresh by the mission stream; the originals of marked-up screenshots are left out (the marked copy stands for both).
 */
const MissionMediaContext = createContext<{ shown: MediaCapture[]; markedCopy: Map<string, string> }>({ shown: [], markedCopy: new Map() });

export function useMissionMedia(): MediaCapture[] {
  return useContext(MissionMediaContext).shown;
}

/** A reference to the original of a marked-up screenshot means its marked copy, the one the page shows. */
export function useShownId(): (id: string) => string {
  const { markedCopy } = useContext(MissionMediaContext);
  return (id) => markedCopy.get(id) ?? id;
}

export function MissionMediaProvider({ missionKey, children }: { missionKey: string; children: React.ReactNode }) {
  const list = useApi<MediaCapture[]>(`/api/v1/missions/${missionKey}/media`);
  const reload = useRef(list.reload);
  reload.current = list.reload;
  useEffect(
    () =>
      subscribe(`/api/v1/missions/${missionKey}/stream`, ({ event }) => {
        if (event.startsWith("media.")) void reload.current();
      }),
    [missionKey],
  );
  const value = useMemo(() => {
    const all = (list.data ?? []).filter((c) => c.status !== "deleted");
    return { shown: visibleCaptures(all), markedCopy: new Map(all.filter((c) => c.annotatedOf).map((c) => [c.annotatedOf!, c.id])) };
  }, [list.data]);
  return <MissionMediaContext.Provider value={value}>{children}</MissionMediaContext.Provider>;
}
