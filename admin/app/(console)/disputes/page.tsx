"use client";

import { useState } from "react";
import { patch, qs } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, errorKey } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Dispute = {
  id: string; status: string; ride_id?: string; opened_by_role?: string; subject?: string;
  description?: string; created_at: string; resolution_note?: string | null;
};

const STATES = ["open", "in_review", "resolved", "rejected"] as const;
const LABEL: Record<string, { fr: string; en: string }> = {
  open: { fr: "Ouvert", en: "Open" },
  in_review: { fr: "En cours d'examen", en: "In review" },
  resolved: { fr: "Résolu", en: "Resolved" },
  rejected: { fr: "Rejeté", en: "Rejected" },
};

export default function DisputesPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<string>("open");
  const { data, error, loading, reload } = useApi<Page<Dispute>>(`/admin/disputes${qs({ status })}`);

  async function move(d: Dispute, next: string) {
    const note = next === "resolved" || next === "rejected"
      ? window.prompt(lang === "fr" ? "Note de résolution" : "Resolution note") : null;
    if ((next === "resolved" || next === "rejected") && !note) return;
    try {
      await patch(`/admin/disputes/${d.id}`, { status: next, resolution_note: note });
      toast(LABEL[next][lang]);
      reload();
    } catch (e) {
      toast(t(errorKey(e)), true);
    }
  }

  return (
    <>
      <div className="page-head"><h1>{t("nav.disputes")}</h1></div>
      <div className="tabs" role="tablist">
        {STATES.map((s) => (
          <button key={s} role="tab" className="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
            {LABEL[s][lang]}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        data.items.length === 0 ? <div className="panel empty"><p>{t("disputes.empty")}</p></div> : (
          <div style={{ display: "grid", gap: 12 }}>
            {data.items.map((d) => (
              <section key={d.id} className="panel" style={{ marginTop: 0 }}>
                <div className="panel-head">
                  <h3>{d.subject ?? "—"}</h3>
                  <span className="muted num">{dateTime(d.created_at, lang)}</span>
                </div>
                {d.description && <p style={{ maxWidth: "70ch" }}>{d.description}</p>}
                {d.resolution_note && <p className="alert alert-info" style={{ marginTop: 10 }}>{d.resolution_note}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  {d.status === "open" && <button className="btn btn-secondary btn-sm" onClick={() => move(d, "in_review")}>{LABEL.in_review[lang]}</button>}
                  {(d.status === "open" || d.status === "in_review") && (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => move(d, "resolved")}>{LABEL.resolved[lang]}</button>
                      <button className="btn btn-warn-outline btn-sm" onClick={() => move(d, "rejected")}>{LABEL.rejected[lang]}</button>
                    </>
                  )}
                </div>
              </section>
            ))}
          </div>
        )
      )}
    </>
  );
}
