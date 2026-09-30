"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, Panel } from "@/components/app/ui";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID, type RoleId } from "@/lib/app/roles";
import { subscribe } from "@/lib/app/stream";
import type { MediaCapture } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

import { CaptureBar } from "./capture-bar";
import { CaptureCard } from "./capture-card";
import type { MediaSeek } from "./media-chip";
import type { PlayerHandle } from "./media-player";

/** Hide the originals of marked-up screenshots: the marked copy stands for both. */
export function visibleCaptures(list: MediaCapture[]): MediaCapture[] {
  const shadowed = new Set(list.map((m) => m.annotatedOf).filter(Boolean));
  return list.filter((m) => !shadowed.has(m.id));
}

/** Every capture on the mission, in time order, and a way to add one without chatting. */
export function EvidenceTab({ missionKey, seek }: { missionKey: string; seek: (MediaSeek & { n: number }) | null }) {
  const { me } = useAuth();
  const role = ROLE_BY_ID[me!.role as RoleId];
  const list = useApi<MediaCapture[]>(`/api/v1/missions/${missionKey}/media`);
  const [items, setItems] = useState<MediaCapture[]>([]);
  const cards = useRef(new Map<string, PlayerHandle | null>());
  useEffect(() => setItems(list.data ?? []), [list.data]);

  const reload = useRef(list.reload);
  reload.current = list.reload;
  useEffect(
    () =>
      subscribe(`/api/v1/missions/${missionKey}/stream`, ({ event }) => {
        if (event === "media.attached" || event === "media.deleted" || event === "media.analyzed" || event === "media.withheld") void reload.current();
      }),
    [missionKey],
  );

  // A ▶ chip in a spec file: bring the capture into view and play from that moment.
  useEffect(() => {
    if (!seek) return;
    const t = setTimeout(() => {
      document.querySelector(`[data-media="${seek.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      cards.current.get(seek.id)?.seek(seek.t);
    }, 150);
    return () => clearTimeout(t);
  }, [seek, items]);

  const add = useCallback((c: MediaCapture) => setItems((xs) => [...xs, c]), []);
  const shown = visibleCaptures(items);

  return (
    <div className="space-y-5 pt-5">
      <Panel title="Show NoX">
        <p className="mb-3 text-[13px] text-ink-muted">
          Record your screen, take a screenshot, leave a voice note or upload a file. NoX watches it, looks it up in the knowledge base, and uses it in every draft and chat on this mission.
        </p>
        <CaptureBar missionKey={missionKey} onMedia={add} />
      </Panel>
      {list.loading && !items.length ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : shown.length ? (
        <ol className="space-y-4" aria-label="Captures">
          {shown.map((c) => (
            <li key={c.id}>
              <CaptureCard
                ref={(h) => {
                  cards.current.set(c.id, h);
                }}
                capture={c}
                onDeleted={(id) => setItems((xs) => xs.filter((x) => x.id !== id))}
              />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState role={role} line="Nothing shown to NoX yet. A 30-second recording often says more than three messages." />
      )}
    </div>
  );
}
