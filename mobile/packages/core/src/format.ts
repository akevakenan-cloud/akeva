import type { Lang } from "./i18n";

export function xaf(amount: number | null | undefined, lang: Lang): string {
  const n = new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 0 }).format(amount ?? 0);
  return `${n} FCFA`; // the name people use every day for XAF
}

export function phone(e164: string): string {
  const m = /^\+(\d{3})(\d+)$/.exec(e164);
  if (!m) return e164;
  const d = m[2];
  const head = d.length % 2 ? d.slice(0, 3) : d.slice(0, 2);
  return [`+${m[1]}`, head, ...(d.slice(head.length).match(/\d{2}/g) ?? [])].join(" ");
}

export function errorText(code: string, t: (k: string) => string): string {
  if (code === "network") return t("common.network");
  return t("common.error");
}
