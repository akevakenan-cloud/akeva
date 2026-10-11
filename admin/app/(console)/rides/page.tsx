"use client";

import { useState } from "react";
import { download, qs } from "@/lib/api";
import { dateTime, xaf } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Category, Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CategoryTag, ErrorNote, Loading, Pager } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Ride = {
  id: string; status: string; category: Category; country: string; created_at: string;
  pickup?: { address?: string }; dropoff?: { address?: string };
  fare?: { total: number }; payment?: { method: string };
};

const STATUSES = ["", "requested", "accepted", "arriving", "in_progress", "completed", "cancelled"];
const RIDE_STATUS: Record<string, { fr: string; en: string }> = {
  "": { fr: "Toutes", en: "All" },
  requested: { fr: "Demandée", en: "Requested" },
  accepted: { fr: "Acceptée", en: "Accepted" },
  arriving: { fr: "Chauffeur en route", en: "Driver on the way" },
  in_progress: { fr: "En cours", en: "In progress" },
  completed: { fr: "Terminée", en: "Completed" },
  cancelled: { fr: "Annulée", en: "Cancelled" },
};

export default function RidesPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<Page<Ride>>(`/admin/rides${qs({ status, page, page_size: 25 })}`);

  return (
    <>
      <div className="page-head">
        <h1>{t("nav.rides")}</h1>
        <button className="btn btn-secondary"
                onClick={() => download("/admin/export/rides.csv", "akeva-rides.csv").catch(() => toast(t("error.generic"), true))}>
          {t("action.export")}
        </button>
      </div>
      <div className="tabs" role="tablist">
        {STATUSES.map((s) => (
          <button key={s || "all"} role="tab" className="tab" aria-selected={status === s}
                  onClick={() => { setStatus(s); setPage(1); }}>
            {RIDE_STATUS[s][lang]}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="table-wrap">
          {data.items.length === 0 ? <div className="empty"><p>{t("rides.empty")}</p></div> : (
            <table>
              <thead>
                <tr><th>{t("audit.when")}</th><th>{t("people.category")}</th><th>{t("field.status")}</th>
                  <th>{t("rides.route")}</th><th style={{ textAlign: "right" }}>XAF</th></tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{dateTime(r.created_at, lang)}</td>
                    <td><CategoryTag category={r.category} /></td>
                    <td>{RIDE_STATUS[r.status]?.[lang] ?? r.status}</td>
                    <td>
                      <div>{r.pickup?.address ?? "—"}</div>
                      <div className="cell-sub">{r.dropoff?.address ?? ""}</div>
                    </td>
                    <td className="num cell-strong" style={{ textAlign: "right" }}>{r.fare ? xaf(r.fare.total, lang) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {data && <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />}
    </>
  );
}
