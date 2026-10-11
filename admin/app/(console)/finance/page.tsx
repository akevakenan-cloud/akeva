"use client";

import { useState } from "react";
import { qs } from "@/lib/api";
import { num, xaf } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { COUNTRIES } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CategoryTag, ErrorNote, Loading } from "@/components/ui";
import type { Category } from "@/lib/types";

type Summary = {
  totals: { rides: number; gross: number; commission: number; driver_earnings: number };
  by_category: Record<string, { rides: number; gross: number; commission: number }>;
  by_payment_method: Record<string, number>;
};

export default function FinancePage() {
  const { t, lang } = useI18n();
  const [country, setCountry] = useState("");
  const { data, error, loading } = useApi<Summary>(`/admin/finance/summary${qs({ country })}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("nav.finance")}</h1>
          <p className="muted">{t("finance.last30")}</p>
        </div>
        <select className="select" style={{ width: "auto" }} aria-label={t("people.country")} value={country}
                onChange={(e) => setCountry(e.target.value)}>
          <option value="">{t("people.country")}: {t("status.all")}</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c[lang]}</option>)}
        </select>
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="stats">
            <div className="stat"><div className="stat-value">{num(data.totals.rides, lang)}</div><div className="stat-label">{t("finance.rides")}</div></div>
            <div className="stat"><div className="stat-value">{xaf(data.totals.gross, lang)}</div><div className="stat-label">{t("finance.gross")}</div></div>
            <div className="stat"><div className="stat-value">{xaf(data.totals.commission, lang)}</div><div className="stat-label">{t("finance.commission")}</div></div>
            <div className="stat"><div className="stat-value">{xaf(data.totals.driver_earnings, lang)}</div><div className="stat-label">{t("finance.earnings")}</div></div>
          </div>
          {data.totals.rides === 0 ? <div className="panel empty"><p>{t("finance.empty")}</p></div> : (
            <div className="grid-2">
              <section className="panel">
                <div className="panel-head"><h2>{t("finance.byCategory")}</h2></div>
                <table>
                  <tbody>
                    {Object.entries(data.by_category).map(([cat, v]) => (
                      <tr key={cat}>
                        <td><CategoryTag category={cat as Category} /></td>
                        <td className="num">{num(v.rides, lang)}</td>
                        <td className="num cell-strong" style={{ textAlign: "right" }}>{xaf(v.gross, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="panel">
                <div className="panel-head"><h2>{t("finance.byMethod")}</h2></div>
                <table>
                  <tbody>
                    {Object.entries(data.by_payment_method).map(([method, total]) => (
                      <tr key={method}>
                        <td className="cell-strong">{method.replace(/_/g, " ")}</td>
                        <td className="num" style={{ textAlign: "right" }}>{xaf(total, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
