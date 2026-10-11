"use client";

import { useState } from "react";
import { download, post, qs } from "@/lib/api";
import { dateTime, phone, xaf } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Category, Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CategoryTag, ErrorNote, Loading, Pager, errorKey } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Ride = {
  id: string; status: string; category: Category; country: string; created_at: string;
  pickup?: { address?: string | null }; dropoff?: { address?: string | null };
  estimate?: { fare: { total: number } };
  fare?: { total: number } | null;
  payment?: { method: string; status: "pending" | "paid" | "failed" | null; reference?: string };
  rider?: { name: string | null; phone: string }; driver?: { name: string | null; phone: string; vehicle?: { plate_number: string } } | null;
  cancel_reason?: string | null;
};

const STATUSES = ["", "requested", "accepted", "arrived", "in_progress", "completed", "cancelled"];
const RIDE_STATUS: Record<string, { fr: string; en: string }> = {
  "": { fr: "Toutes", en: "All" },
  requested: { fr: "Recherche chauffeur", en: "Finding driver" },
  accepted: { fr: "Chauffeur en route", en: "Driver on the way" },
  arrived: { fr: "Chauffeur sur place", en: "Driver at pickup" },
  in_progress: { fr: "En cours", en: "In progress" },
  completed: { fr: "Terminée", en: "Completed" },
  cancelled: { fr: "Annulée", en: "Cancelled" },
};
const UNFINISHED = new Set(["requested", "accepted", "arrived", "in_progress"]);

export default function RidesPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Page<Ride>>(`/admin/rides${qs({ status, page, page_size: 25 })}`);

  async function cancel(r: Ride) {
    const reason = window.prompt(t("decision.reason"));
    if (!reason || reason.trim().length < 3) return;
    try {
      await post(`/admin/rides/${r.id}/cancel`, { reason: reason.trim() });
      toast(RIDE_STATUS.cancelled[lang]);
      reload();
    } catch (e) {
      toast(t(errorKey(e)), true);
    }
  }

  async function confirmPayment(r: Ride, paid: boolean) {
    const reference = paid ? window.prompt(t("rides.paymentRef")) : null;
    if (paid && !reference) return;
    try {
      await post(`/admin/rides/${r.id}/payment`, { paid, reference });
      toast(t(paid ? "rides.paymentConfirmed" : "rides.paymentFailed"));
      reload();
    } catch (e) {
      toast(t(errorKey(e)), true);
    }
  }

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
                  <th>{t("rides.people")}</th><th>{t("rides.route")}</th><th style={{ textAlign: "right" }}>XAF</th><th /></tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{dateTime(r.created_at, lang)}</td>
                    <td><CategoryTag category={r.category} /></td>
                    <td>
                      <div>{RIDE_STATUS[r.status]?.[lang] ?? r.status}</div>
                      {r.cancel_reason ? <div className="cell-sub">{r.cancel_reason}</div> : null}
                    </td>
                    <td>
                      <div>{r.rider?.name ?? "—"} <span className="cell-sub num">{r.rider ? phone(r.rider.phone) : ""}</span></div>
                      {r.driver ? <div className="cell-sub">{r.driver.name}, {r.driver.vehicle?.plate_number}</div> : null}
                    </td>
                    <td>
                      <div>{r.pickup?.address ?? "—"}</div>
                      <div className="cell-sub">{r.dropoff?.address ?? ""}</div>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      <div className="cell-strong">{xaf(r.fare?.total ?? r.estimate?.fare.total ?? 0, lang)}</div>
                      {r.payment ? (
                        <div className="cell-sub">
                          {r.payment.method.replace(/_/g, " ")}
                          {r.payment.status === "pending" ? `, ${t("rides.paymentPending")}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {UNFINISHED.has(r.status) ? (
                        <button className="btn btn-danger-outline btn-sm" onClick={() => cancel(r)}>{t("action.cancelRide")}</button>
                      ) : null}
                      {r.status === "completed" && r.payment?.status === "pending" ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => confirmPayment(r, true)}>{t("rides.confirmPayment")}</button>{" "}
                          <button className="btn btn-secondary btn-sm" onClick={() => confirmPayment(r, false)}>{t("rides.markFailed")}</button>
                        </>
                      ) : null}
                    </td>
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
