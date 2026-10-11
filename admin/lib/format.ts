import type { Lang } from "./i18n";

const locale = (lang: Lang) => (lang === "fr" ? "fr-FR" : "en-GB");

export function xaf(amount: number | null | undefined, lang: Lang): string {
  // XAF has no minor unit.
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency: "XAF", maximumFractionDigits: 0 })
    .format(amount ?? 0);
}

export function num(n: number | null | undefined, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang)).format(n ?? 0);
}

export function dateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function date(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: "medium" }).format(new Date(iso));
}

/** "il y a 3 h" / "3 h ago" for review queues, where waiting time matters. */
export function ago(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto", style: "short" });
  const abs = Math.abs(secs);
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  return rtf.format(Math.round(secs / 86400), "day");
}

export function phone(e164: string): string {
  // +237677123456 -> +237 677 12 34 56 (readable groups; exact grouping varies by country)
  const m = /^\+(\d{3})(\d+)$/.exec(e164);
  if (!m) return e164;
  const digits = m[2];
  const head = digits.length % 2 ? digits.slice(0, 3) : digits.slice(0, 2);
  const pairs = digits.slice(head.length).match(/\d{2}/g) ?? [];
  return [`+${m[1]}`, head, ...pairs].join(" ");
}
