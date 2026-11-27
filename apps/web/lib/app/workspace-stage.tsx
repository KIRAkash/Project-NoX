"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { useAuth, type Me, type ReadinessSummary } from "./auth";

export function deriveReadiness(me: Me | null | undefined): ReadinessSummary {
  if (me?.readiness) return me.readiness;
  return {
    orgs: me?.orgs.length ?? 0,
    apps: 0,
    publishedWikis: 0,
    missions: 0,
  };
}

type WorkspaceStageState = {
  readiness: ReadinessSummary;
  hasApps: boolean;
  hasMissions: boolean;
  showAllPanels: boolean;
  setShowAllPanels: React.Dispatch<React.SetStateAction<boolean>>;
  moreNavOpen: boolean;
  setMoreNavOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const WorkspaceStageContext = createContext<WorkspaceStageState | null>(null);

export function WorkspaceStageProvider({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const readiness = useMemo(() => deriveReadiness(me), [me]);
  const [showAllPanels, setShowAllPanels] = useState(false);
  const [moreNavOpen, setMoreNavOpen] = useState(false);

  const value = useMemo<WorkspaceStageState>(
    () => ({
      readiness,
      hasApps: readiness.apps > 0,
      hasMissions: readiness.missions > 0,
      showAllPanels,
      setShowAllPanels,
      moreNavOpen,
      setMoreNavOpen,
    }),
    [readiness, showAllPanels, moreNavOpen],
  );

  return <WorkspaceStageContext.Provider value={value}>{children}</WorkspaceStageContext.Provider>;
}

/**
 * Reads staged workspace state from `AppShell` when present, or falls back to local component state
 * so individual seat home components also work in isolated tests.
 */
export function useWorkspaceStage(): WorkspaceStageState {
  const ctx = useContext(WorkspaceStageContext);
  const [localPanels, setLocalPanels] = useState(false);
  const [localNav, setLocalNav] = useState(false);
  if (ctx) return ctx;
  return {
    readiness: { orgs: 0, apps: 0, publishedWikis: 0, missions: 0 },
    hasApps: false,
    hasMissions: false,
    showAllPanels: localPanels,
    setShowAllPanels: setLocalPanels,
    moreNavOpen: localNav,
    setMoreNavOpen: setLocalNav,
  };
}
