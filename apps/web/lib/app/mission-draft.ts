"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import type { MediaCapture } from "./types";

export type DraftMissionType = "feature" | "bug" | "change";

export type MissionDraft = {
  prompt: string;
  type: DraftMissionType;
  jiraKey: string | null;
  mediaIds: string[];
  hiddenMediaIds: string[];
};

const PREFIX = "nox.missionDraft.";

export const EMPTY_DRAFT: MissionDraft = {
  prompt: "",
  type: "feature",
  jiraKey: null,
  mediaIds: [],
  hiddenMediaIds: [],
};

export function draftStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function hasDraftContent(d: MissionDraft): boolean {
  return Boolean(
    d.prompt.trim().length > 0 ||
      d.jiraKey ||
      d.mediaIds.length > 0 ||
      d.hiddenMediaIds.length > 0 ||
      d.type !== "feature",
  );
}

function normalizeDraft(raw: unknown): MissionDraft {
  if (!raw || typeof raw !== "object") return { ...EMPTY_DRAFT };
  const obj = raw as Record<string, unknown>;
  const prompt = typeof obj.prompt === "string" ? obj.prompt : "";
  const type: DraftMissionType =
    obj.type === "bug" || obj.type === "change" || obj.type === "feature" ? obj.type : "feature";
  const jiraKey = typeof obj.jiraKey === "string" && obj.jiraKey.trim() ? obj.jiraKey.trim() : null;
  const mediaIds = Array.isArray(obj.mediaIds)
    ? obj.mediaIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const hiddenMediaIds = Array.isArray(obj.hiddenMediaIds)
    ? obj.hiddenMediaIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  return { prompt, type, jiraKey, mediaIds, hiddenMediaIds };
}

export function readMissionDraft(userId: string | null | undefined): MissionDraft {
  if (!userId || typeof window === "undefined") return { ...EMPTY_DRAFT };
  try {
    const raw = window.localStorage.getItem(draftStorageKey(userId));
    if (!raw) return { ...EMPTY_DRAFT };
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function writeMissionDraft(userId: string | null | undefined, draft: MissionDraft): void {
  if (!userId || typeof window === "undefined") return;
  try {
    const key = draftStorageKey(userId);
    if (!hasDraftContent(draft)) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(draft));
    }
  } catch {
    /* storage unavailable */
  }
}

export function clearMissionDraft(userId: string | null | undefined): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftStorageKey(userId));
  } catch {
    /* ignore */
  }
}

export function clearAllMissionDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * Shared mission composer draft state backed by localStorage under `nox.missionDraft.<userId>`.
 * Keeps prompt, request type, linked Jira key, and Show NoX capture IDs across route changes,
 * and clears automatically when the mission is created or the user signs out.
 */
export function useMissionDraft(
  userId: string | null | undefined,
  options?: { skipPersistence?: boolean },
) {
  const skip = Boolean(options?.skipPersistence);
  const [draft, setDraft] = useState<MissionDraft>(() =>
    skip ? { ...EMPTY_DRAFT } : readMissionDraft(userId),
  );
  const [captures, setCaptures] = useState<MediaCapture[]>([]);
  const hydratedUser = useRef<string | null | undefined>(skip ? null : userId);

  // Re-read if userId changes or skip toggles off.
  useEffect(() => {
    if (skip) return;
    if (hydratedUser.current !== userId) {
      hydratedUser.current = userId;
      setDraft(readMissionDraft(userId));
      setCaptures([]);
    }
  }, [userId, skip]);

  // Hydrate saved draft captures from the API when mounting onto a page with stored mediaIds.
  useEffect(() => {
    if (skip || !userId || !draft.mediaIds.length) return;
    let cancelled = false;
    const hiddenSet = new Set(draft.hiddenMediaIds);
    const visibleIds = draft.mediaIds.filter((id) => !hiddenSet.has(id));
    if (!visibleIds.length) return;
    void Promise.all(
      visibleIds.map((id) => api<MediaCapture>(`/api/v1/media/${encodeURIComponent(id)}`).catch(() => null)),
    ).then((loaded) => {
      if (cancelled) return;
      const valid = loaded.filter((c): c is MediaCapture => c !== null && c.status !== "deleted");
      if (valid.length) {
        setCaptures((cur) => {
          const existing = new Set(cur.map((x) => x.id));
          return [...cur, ...valid.filter((v) => !existing.has(v.id))];
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per user mount
  }, [userId, skip]);

  const updateDraft = useCallback(
    (updater: (prev: MissionDraft) => MissionDraft) => {
      setDraft((prev) => {
        const next = updater(prev);
        if (!skip) writeMissionDraft(userId, next);
        return next;
      });
    },
    [userId, skip],
  );

  const setPrompt = useCallback(
    (prompt: string) => updateDraft((prev) => ({ ...prev, prompt })),
    [updateDraft],
  );

  const setType = useCallback(
    (type: DraftMissionType) => updateDraft((prev) => ({ ...prev, type })),
    [updateDraft],
  );

  const setJiraKey = useCallback(
    (jiraKey: string | null) => updateDraft((prev) => ({ ...prev, jiraKey })),
    [updateDraft],
  );

  const addCapture = useCallback(
    (c: MediaCapture, extraHidden: string[] = []) => {
      setCaptures((xs) => [...xs, c]);
      updateDraft((prev) => {
        const hiddenMediaIds = Array.from(new Set([...prev.hiddenMediaIds, ...extraHidden]));
        const mediaIds = Array.from(new Set([...prev.mediaIds, c.id, ...extraHidden]));
        return { ...prev, mediaIds, hiddenMediaIds };
      });
    },
    [updateDraft],
  );

  const updateCapture = useCallback((next: MediaCapture) => {
    setCaptures((xs) => xs.map((x) => (x.id === next.id ? next : x)));
  }, []);

  const removeCapture = useCallback(
    (id: string) => {
      setCaptures((xs) => xs.filter((x) => x.id !== id));
      updateDraft((prev) => ({
        ...prev,
        mediaIds: prev.mediaIds.filter((x) => x !== id),
        hiddenMediaIds: prev.hiddenMediaIds.filter((x) => x !== id),
      }));
    },
    [updateDraft],
  );

  const clearDraft = useCallback(() => {
    clearMissionDraft(userId);
    setDraft({ ...EMPTY_DRAFT });
    setCaptures([]);
  }, [userId]);

  // All attachable media IDs (loaded captures that weren't withheld + any stored IDs not yet hydrated + hidden originals).
  const withheldIds = new Set(captures.filter((c) => c.status === "withheld").map((c) => c.id));
  const allMediaIds = Array.from(
    new Set([
      ...captures.filter((c) => c.status !== "withheld").map((c) => c.id),
      ...draft.mediaIds.filter((id) => !withheldIds.has(id)),
      ...draft.hiddenMediaIds,
    ]),
  );

  const hasSavedDraft =
    !skip &&
    Boolean(
      hasDraftContent(draft) ||
        allMediaIds.length > 0,
    );

  return {
    prompt: draft.prompt,
    type: draft.type,
    jiraKey: draft.jiraKey,
    captures,
    mediaIds: allMediaIds,
    hasSavedDraft,
    setPrompt,
    setType,
    setJiraKey,
    addCapture,
    updateCapture,
    removeCapture,
    clearDraft,
  };
}
