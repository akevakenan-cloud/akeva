"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, loadSession, post, saveSession, setSessionLostHandler } from "./api";
import type { User } from "./types";

type AuthState = {
  user: User | null;
  ready: boolean;
  signIn: (accessToken: string, refreshToken: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const me = await api<User>("/me");
      if (me.role !== "admin" && me.role !== "super_admin") throw new Error("not staff");
      setUser(me);
    } catch {
      saveSession(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      router.replace("/login?expired=1");
    });
    (async () => {
      if (loadSession()) await loadMe();
      setReady(true);
    })();
  }, [loadMe, router]);

  const signIn = useCallback(
    async (access: string, refresh: string) => {
      saveSession({ access, refresh });
      await loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    try {
      await post("/auth/logout");
    } catch {}
    saveSession(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  return <AuthContext.Provider value={{ user, ready, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
