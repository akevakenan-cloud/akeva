"use client";

import Link from "next/link";
import { xaf, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, StatusBadge } from "@/components/ui";
import type { Status } from "@/lib/types";

type Overview = {
  drivers: Record<string, number>;
  riders: Record<string, number>;
  pending_reviews: number;
  drivers_online: number;
  active_rides: number;
  rides_24h: number;
  gross_24h: number;
  commission_24h: number;
  open_disputes: number;
  pending_deletions: number;
};

const ORDER: Status[] = ["pending", "approved", "onboarding", "rejected", "suspended", "banned"];

export default function OverviewPage() {
  const { t, lang } = useI18n();
  const { data, error, loading } = useApi<Overview>("/admin/overview");

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;

  const firstQueue = (data.drivers.pending ?? 0) > 0 || !(data.riders.pending ?? 0) ? "/drivers" : "/riders";

  return (
    <>
      <div className="page-head">
        <h1>{t("nav.overview")}</h1>
      </div>

      <div className="stats">
        <div className={`stat ${data.pending_reviews ? "stat-attention" : ""}`}>
          <div className="stat-value">{num(data.pending_reviews, lang)}</div>
          <div className="stat-label">{t("overview.pending")}</div>
          {data.pending_reviews > 0 && (
            <Link href={`${firstQueue}?status=pending`} className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
              {t("overview.reviewNow")}
            </Link>
          )}
        </div>
        <div className="stat">
          <div className="stat-value">{num(data.drivers_online, lang)}</div>
          <div className="stat-label">{t("overview.online")}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{num(data.active_rides, lang)}</div>
          <div className="stat-label">{t("overview.active")}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{num(data.rides_24h, lang)}</div>
          <div className="stat-label">{t("overview.rides24")}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{xaf(data.gross_24h, lang)}</div>
          <div className="stat-label">{t("overview.gross24")}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{xaf(data.commission_24h, lang)}</div>
          <div className="stat-label">{t("overview.commission24")}</div>
        </div>
      </div>

      <div className="grid-2">
        {(["drivers", "riders"] as const).map((group) => (
          <section className="panel" key={group}>
            <div className="panel-head">
              <h2>{t(`overview.${group}`)}</h2>
              <Link href={`/${group}`}>{t(`nav.${group}`)}</Link>
            </div>
            <table>
              <tbody>
                {ORDER.map((s) => (
                  <tr key={s}>
                    <td><StatusBadge status={s} /></td>
                    <td className="num cell-strong" style={{ textAlign: "right" }}>{num(data[group][s] ?? 0, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      {(data.open_disputes > 0 || data.pending_deletions > 0) && (
        <div className="grid-2" style={{ marginTop: 16 }}>
          {data.open_disputes > 0 && (
            <Link href="/disputes" className="panel" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="stat-value">{num(data.open_disputes, lang)}</div>
              <div className="stat-label">{t("overview.disputes")}</div>
            </Link>
          )}
          {data.pending_deletions > 0 && (
            <Link href="/deletions" className="panel" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="stat-value">{num(data.pending_deletions, lang)}</div>
              <div className="stat-label">{t("overview.deletions")}</div>
            </Link>
          )}
        </div>
      )}
    </>
  );
}
