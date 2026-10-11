"use client";

import { useState } from "react";
import { post, qs } from "@/lib/api";
import { dateTime, phone, xaf } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, errorKey } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Payout = {
  id: string; driver_id: string; driver_name: string | null; driver_phone: string; amount: number;
  method: string; status: string; created_at: string; reference?: string | null; note?: string | null;
  destination?: { method: string | null; account_name: string | null; account_number: string | null; bank_name: string | null };
  balance?: number;
};

const TABS = ["requested", "paid", "rejected"] as const;

/** Driver withdrawal requests: send the money, then record the transfer reference here. */
export default function PayoutsPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<(typeof TABS)[number]>("requested");
  const { data, error, loading, reload } = useApi<Payout[]>(`/admin/payouts${qs({ status })}`);

  async function decide(p: Payout, approve: boolean) {
    const input = window.prompt(t(approve ? "payouts.reference" : "decision.reason"));
    if (!input || !input.trim()) return;
    try {
      await post(`/admin/payouts/${p.id}/decision`, approve
        ? { approve: true, reference: input.trim() }
        : { approve: false, note: input.trim() });
      toast(t(approve ? "payouts.paid" : "payouts.rejected"));
      reload();
    } catch (e) {
      toast(t(errorKey(e)), true);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("nav.payouts")}</h1>
          <p className="muted" style={{ maxWidth: "70ch" }}>{t("payouts.hint")}</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((s) => (
          <button key={s} role="tab" className="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
            {t(`payouts.tab.${s}`)}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        data.length === 0 ? <div className="panel empty"><p>{t("payouts.empty")}</p></div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t("nav.drivers")}</th><th>{t("payouts.destination")}</th><th style={{ textAlign: "right" }}>XAF</th>
                  <th>{t("audit.when")}</th><th /></tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a className="cell-strong" href={`/drivers/${p.driver_id}`}>{p.driver_name ?? "—"}</a>
                      <div className="cell-sub num">{phone(p.driver_phone)}</div>
                    </td>
                    <td>
                      {p.destination ? (
                        <>
                          <div>{p.destination.method?.replace(/_/g, " ")}{p.destination.bank_name ? `, ${p.destination.bank_name}` : ""}</div>
                          <div className="cell-sub num">{p.destination.account_name}, {p.destination.account_number}</div>
                        </>
                      ) : <span className="muted">{p.reference ?? p.note ?? ""}</span>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      <div className="cell-strong">{xaf(p.amount, lang)}</div>
                      {p.balance !== undefined ? <div className="cell-sub">{t("payouts.balanceAfter")}: {xaf(p.balance, lang)}</div> : null}
                    </td>
                    <td className="cell-sub">{dateTime(p.created_at, lang)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {p.status === "requested" ? (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => decide(p, false)}>{t("action.reject")}</button>{" "}
                          <button className="btn btn-primary btn-sm" onClick={() => decide(p, true)}>{t("payouts.markPaid")}</button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
