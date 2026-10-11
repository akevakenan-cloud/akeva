"use client";

import { useState } from "react";
import { download, qs } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { AuditEntry, Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, Pager } from "@/components/ui";
import { useToast } from "@/components/Toast";

const PAGE_SIZE = 50;

export default function AuditPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [input, setInput] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<Page<AuditEntry>>(`/admin/audit-logs${qs({ action, page, page_size: PAGE_SIZE })}`);

  const targetHref = (a: AuditEntry) =>
    a.target_type === "driver" ? `/drivers/${a.target_id}` : a.target_type === "rider" ? `/riders/${a.target_id}` : null;

  return (
    <>
      <div className="page-head">
        <h1>{t("nav.audit")}</h1>
        <button className="btn btn-secondary"
                onClick={() => download("/admin/export/audit_logs.csv", "akeva-audit.csv").catch(() => toast(t("error.generic"), true))}>
          {t("action.export")}
        </button>
      </div>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setPage(1); setAction(input.trim()); }}>
        <input className="input grow" placeholder={t("audit.filter")} aria-label={t("audit.filter")}
               value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn btn-primary">{t("action.search")}</button>
      </form>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t("audit.when")}</th><th>{t("audit.who")}</th><th>{t("audit.what")}</th><th>{t("audit.target")}</th><th>{t("audit.reason")}</th></tr>
            </thead>
            <tbody>
              {data.items.map((a) => {
                const href = targetHref(a);
                return (
                  <tr key={a.id}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{dateTime(a.created_at, lang)}</td>
                    <td>
                      <div className="cell-strong">{a.actor_name ?? a.actor_role}</div>
                      {a.ip && <div className="cell-sub num">{a.ip}</div>}
                    </td>
                    <td><code>{a.action}</code></td>
                    <td>{href ? <a href={href}>{a.target_type}</a> : a.target_type}</td>
                    <td style={{ maxWidth: 320 }}>{a.reason ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
    </>
  );
}
