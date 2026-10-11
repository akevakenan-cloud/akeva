import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { get } from "./api";

export type AppConfig = {
  currency: string;
  consent_version: string;
  mapbox_public_token: string;
  categories: { id: string; fr: string; en: string; min_year: number | null; vehicle: "car" | "moto" }[];
  countries: {
    code: string; dial_code: string; name_fr: string; name_en: string; payout_methods: string[];
    cities: { id: string | null; name: string; lat?: number; lng?: number }[];
  }[];
};

const KEY = "akeva.config";
let memory: AppConfig | null = null;

/** Public app configuration, cached on the device so screens work on a flaky network. */
export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(memory);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!memory) {
        const cached = await AsyncStorage.getItem(KEY).catch(() => null);
        if (cached && alive) setConfig((memory = JSON.parse(cached)));
      }
      try {
        const fresh = await get<AppConfig>("/config");
        memory = fresh;
        AsyncStorage.setItem(KEY, JSON.stringify(fresh)).catch(() => {});
        if (alive) setConfig(fresh);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);
  return config;
}
