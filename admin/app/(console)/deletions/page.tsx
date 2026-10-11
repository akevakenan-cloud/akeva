"use client";

import { post } from "@/lib/api";
import { dateTime, phone } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, errorKey } from "@/components/ui";
import { useToast } from "@/components/Toast";

type DeletionRequest = { id: string; user_id: string; role: string; phone: string | null;
  full_name: string | null; reason: string | null; created_at: string };

export default function DeletionsPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<DeletionRequest[]>("/admin/deletion-requests");
  const canDecide = user?.role === "super_admin";

  async function decide(r: DeletionRequest, approve: boolean) {
    const note = approve ? null : window.prompt(t("decision.reason"));
    if (!approve && !note) return;
    if (approve && !window.confirm(t("deletions.hint"))) return;
    try {
      await post(`/admin/deletion-requests/${r.id}/decision`, { approve, note });
      toast(t("action.done"));
      reload();
    } catch (err) {
      toast(t(errorKey(err)), true);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("nav.deletions")}</h1>
          <p className="muted" style={{ maxWidth: "70ch" }}>{t("deletions.hint")}</p>
        </div>
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        data.length === 0 ? <div className="panel empty"><p>{t("deletions.empty")}</p></div> : (
          <div className="table-wrap">
            <table>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a className="cell-strong" href={`/${r.role}s/${r.user_id}`}>{r.full_name ?? "—"}</a>
                      <div className="cell-sub num">{r.phone ? phone(r.phone) : ""}</div>
                    </td>
                    <td>{t(r.role === "driver" ? "nav.drivers" : "nav.riders")}</td>
                    <td style={{ maxWidth: 320 }}>{r.reason ?? ""}</td>
                    <td className="cell-sub">{dateTime(r.created_at, lang)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canDecide && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => decide(r, false)}>{t("deletions.reject")}</button>{" "}
                          <button className="btn btn-danger btn-sm" onClick={() => decide(r, true)}>{t("deletions.approve")}</button>
                        </>
                      )}
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
