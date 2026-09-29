"use client";

import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError, configureApi } from "./api";
import { firebaseAuth, firebaseConfigured, googleProvider } from "./firebase";
import type { RoleId } from "./roles";

export type Me = {
  id: string;
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  role: RoleId | null;
  capabilities: string[];
  orgs: { id: string; name: string; slug: string; parentOrgId: string | null }[];
};

type Status = "loading" | "signed-out" | "signed-in";

type AuthState = {
  status: Status;
  me: Me | null;
  error: string | null;
  devAuth: boolean;
  signInWithGoogle: () => Promise<void>;
  signInDev: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  chooseRole: (role: RoleId) => Promise<Me>;
};

const AuthContext = createContext<AuthState | null>(null);

const DEV_KEY = "nox.devEmail";
export const DEV_AUTH = process.env.NEXT_PUBLIC_NOX_DEV_AUTH === "true";

function readDevEmail(): string | null {
  try {
    return DEV_AUTH ? window.localStorage.getItem(DEV_KEY) : null;
  } catch {
    return null;
  }
}

function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/network-request-failed") return "Can't reach NoX right now. Check your connection and try again.";
  if (e instanceof ApiError) return e.status === 401 ? "Your sign-in couldn't be verified. Try again." : e.detail;
  return "Something went wrong signing in. Try again.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fbUser = useRef<FirebaseUser | null>(null);
  const devEmail = useRef<string | null>(null);
  const roleRef = useRef<string | null>(null);

  useEffect(() => {
    configureApi({
      credential: async () => {
        if (fbUser.current) return { header: `Bearer ${await fbUser.current.getIdToken()}` };
        if (devEmail.current) return { header: `Dev ${devEmail.current}` };
        return null;
      },
      role: () => roleRef.current,
    });
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const data = await api<Me>("/api/v1/me");
      roleRef.current = data.role;
      setMe(data);
      setStatus("signed-in");
      setError(null);
    } catch (e) {
      setMe(null);
      setStatus("signed-out");
      setError(friendlyError(e) || null);
    }
  }, []);

  useEffect(() => {
    devEmail.current = readDevEmail();
    const auth = firebaseAuth();
    if (!auth) {
      if (devEmail.current) void loadMe();
      else setStatus("signed-out");
      return;
    }
    return onAuthStateChanged(auth, (user) => {
      fbUser.current = user;
      if (user || devEmail.current) void loadMe();
      else {
        setMe(null);
        setStatus("signed-out");
      }
    });
  }, [loadMe]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    const auth = firebaseAuth();
    if (!auth) {
      setError("Google sign-in isn't configured for this deployment.");
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if ((e as { code?: string }).code === "auth/popup-blocked") {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setError(friendlyError(e) || null);
    }
  }, []);

  const signInDev = useCallback(
    async (email: string) => {
      if (!DEV_AUTH) return;
      devEmail.current = email.trim().toLowerCase();
      try {
        window.localStorage.setItem(DEV_KEY, devEmail.current);
      } catch {
        /* storage unavailable: session-only */
      }
      await loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    devEmail.current = null;
    roleRef.current = null;
    try {
      window.localStorage.removeItem(DEV_KEY);
    } catch {
      /* ignore */
    }
    const auth = firebaseAuth();
    if (auth) await firebaseSignOut(auth);
    setMe(null);
    setStatus("signed-out");
  }, []);

  const chooseRole = useCallback(async (role: RoleId) => {
    const data = await api<Me>("/api/v1/me/role", { method: "PUT", json: { role } });
    roleRef.current = data.role;
    setMe(data);
    return data;
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, me, error, devAuth: DEV_AUTH, signInWithGoogle, signInDev, signOut, chooseRole }),
    [status, me, error, signInWithGoogle, signInDev, signOut, chooseRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export { firebaseConfigured };
