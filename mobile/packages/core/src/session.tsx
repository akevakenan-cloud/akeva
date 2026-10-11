import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, get, loadTokens, post, saveTokens, setSignedOutHandler } from "./api";
import type { AppRole, Category } from "./config";

export type Status = "onboarding" | "pending" | "approved" | "rejected" | "suspended" | "banned";

export type Me = {
  id: string;
  phone: string;
  role: AppRole;
  status: Status;
  full_name: string | null;
  email: string | null;
  language: string | null;
  country: string;
  city: string | null;
  id_type: "national_id" | "passport" | null;
  id_number: string | null;
  consent: { documents: boolean; selfie: boolean } | null;
  review: { action: string; reason: string | null } | null;
  rating: { avg: number | null; count: number } | null;
  license_number?: string | null;
  vehicle?: { type: "car" | "moto"; make: string; model: string; year: number; color: string; plate_number: string } | null;
  payout?: { method: string; account_name: string; account_number: string; bank_name?: string | null } | null;
  driver?: { category: Category | null; suggested_category: Category | null; online: boolean; current_ride_id?: string | null };
  onboarding: { status: Status; can_submit: boolean; missing_fields: string[]; missing_documents: string[] };
  documents: { id: string; doc_type: string }[];
};

type Session = {
  ready: boolean;
  me: Me | null;
  offline: boolean;
  refresh: () => Promise<Me | null>;
  signIn: (access: string, refresh: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);
const CACHE_KEY = "akeva.me";

export function SessionProvider({ role, children }: { role: AppRole; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await get<Me>("/me");
      if (data.role !== role) throw new ApiError(403, "wrong_app", null);
      setMe(data);
      setOffline(false);
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
      return data;
    } catch (e) {
      if (e instanceof ApiError && e.code === "network") {
        setOffline(true); // keep showing the cached profile
        return null;
      }
      await saveTokens(null);
      setMe(null);
      return null;
    }
  }, [role]);

  useEffect(() => {
    setSignedOutHandler(() => setMe(null));
    (async () => {
      if (await loadTokens()) {
        const cached = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
        if (cached) setMe(JSON.parse(cached));
        await refresh();
      }
      setReady(true);
    })();
  }, [refresh]);

  const signIn = useCallback(async (access: string, refreshToken: string) => {
    await saveTokens({ access, refresh: refreshToken });
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await post("/auth/logout");
    } catch {}
    await saveTokens(null);
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ ready, me, offline, refresh, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
