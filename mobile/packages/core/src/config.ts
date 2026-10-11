// Values come from EXPO_PUBLIC_* variables, which Expo inlines at build time.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

export type AppRole = "rider" | "driver";

export const CONSENT_VERSION = "2026-10-01";

export const COUNTRIES = [
  { code: "CM", dial: "+237", fr: "Cameroun", en: "Cameroon", lengths: [9] },
  { code: "TD", dial: "+235", fr: "Tchad", en: "Chad", lengths: [8] },
  { code: "GA", dial: "+241", fr: "Gabon", en: "Gabon", lengths: [7, 8] },
  { code: "GQ", dial: "+240", fr: "Guinée Équatoriale", en: "Equatorial Guinea", lengths: [9] },
  { code: "CF", dial: "+236", fr: "Centrafrique", en: "Central African Rep.", lengths: [8] },
  { code: "CG", dial: "+242", fr: "Congo", en: "Congo", lengths: [9] },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

export const CATEGORIES = ["moto", "economy", "comfort", "prestige", "gold", "platinum"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Mobile Money options per country (riders pay with them, drivers get paid with them). */
export const MOBILE_MONEY: Record<CountryCode, string[]> = {
  CM: ["mtn_momo", "orange_money"],
  TD: ["airtel_money", "moov_money"],
  GA: ["airtel_money", "moov_money"],
  GQ: [],
  CF: ["orange_money"],
  CG: ["mtn_momo", "airtel_money"],
};
