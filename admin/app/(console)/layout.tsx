"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import { Loading } from "@/components/ui";

type Overview = { pending_reviews: number; open_disputes: number; pending_deletions: number; pending_payouts: number;
  drivers: Record<string, number>; riders: Record<string, number> };

const SECTIONS: { label: string; links: { href: string; key: string; count?: (o: Overview) => number; superOnly?: boolean }[] }[] = [
  { label: "", links: [{ href: "/overview", key: "nav.overview" }] },
  {
    label: "accounts",
    links: [
      { href: "/drivers", key: "nav.drivers", count: (o) => o.drivers.pending ?? 0 },
      { href: "/riders", key: "nav.riders", count: (o) => o.riders.pending ?? 0 },
    ],
  },
  {
    label: "operations",
    links: [
      { href: "/live", key: "nav.live" },
      { href: "/rides", key: "nav.rides" },
      { href: "/disputes", key: "nav.disputes", count: (o) => o.open_disputes },
      { href: "/payouts", key: "nav.payouts", count: (o) => o.pending_payouts },
      { href: "/finance", key: "nav.finance" },
    ],
  },
  {
    label: "settings",
    links: [
      { href: "/pricing", key: "nav.pricing" },
      { href: "/cities", key: "nav.cities" },
      { href: "/audit", key: "nav.audit" },
      { href: "/deletions", key: "nav.deletions", count: (o) => o.pending_deletions },
      { href: "/staff", key: "nav.staff", superOnly: true },
    ],
  },
];

const GROUP_LABELS: Record<string, { fr: string; en: string }> = {
  accounts: { fr: "Comptes", en: "Accounts" },
  operations: { fr: "Opérations", en: "Operations" },
  settings: { fr: "Paramètres", en: "Settings" },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { data: overview, reload } = useApi<Overview>(user ? "/admin/overview" : null);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  // Keep queue counts fresh as reviews are completed.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, [user, reload, pathname]);

  if (!ready || !user) {
    return <main className="main"><Loading /></main>;
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">A</div>
          <span className="brand-name">Akeva</span>
        </div>
        {SECTIONS.map((section) => (
          <div key={section.label || "top"}>
            {section.label && <div className="nav-group">{GROUP_LABELS[section.label][lang]}</div>}
            {section.links
              .filter((l) => !l.superOnly || user.role === "super_admin")
              .map((l) => {
                const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
                const count = overview && l.count ? l.count(overview) : 0;
                return (
                  <Link key={l.href} href={l.href} className="nav-link" aria-current={active ? "page" : undefined}>
                    <span>{t(l.key)}</span>
                    {count > 0 && <span className="nav-count num">{count}</span>}
                  </Link>
                );
              })}
          </div>
        ))}
        <div className="sidebar-foot">
          <div>
            <div style={{ fontWeight: 700, color: "#fff" }}>{user.full_name}</div>
            <div>{t(`staff.role.${user.role}`)}</div>
          </div>
          <div className="lang-switch" role="group" aria-label="Language">
            {(["fr", "en"] as const).map((l) => (
              <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
          <button className="btn btn-sm" style={{ background: "#1f362b", color: "#fff" }} onClick={signOut}>
            {t("nav.signout")}
          </button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
