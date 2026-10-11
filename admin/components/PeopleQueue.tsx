"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { download, qs } from "@/lib/api";
import { ago, phone } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { CATEGORIES, COUNTRIES, type Page, type Status, type User } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CategoryTag, ErrorNote, Loading, Pager, StatusBadge } from "./ui";
import { useToast } from "./Toast";

const TABS: (Status | "")[] = ["pending", "approved", "onboarding", "rejected", "suspended", "banned", ""];
const PAGE_SIZE = 25;

export function PeopleQueue({ role }: { role: "driver" | "rider" }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = (params.get("status") ?? "pending") as Status | "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [country, setCountry] = useState(params.get("country") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [status, country, category]);

  const path = `/admin/users${qs({ role, status, country, category: role === "driver" ? category : "",
    q: params.get("q"), page, page_size: PAGE_SIZE })}`;
  const { data, error, loading } = useApi<Page<User>>(path);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "status" && !value) next.set("status", "");
    router.replace(`${pathname}?${next.toString()}`);
  }

  const base = role === "driver" ? "/drivers" : "/riders";

  return (
    <>
      <div className="page-head">
        <h1>{t(role === "driver" ? "nav.drivers" : "nav.riders")}</h1>
        <button className="btn btn-secondary"
                onClick={() => download(`/admin/export/${role}s.csv`, `akeva-${role}s.csv`).catch(() => toast(t("error.generic"), true))}>
          {t("action.export")}
        </button>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((s) => (
          <button key={s || "all"} role="tab" className="tab" aria-selected={status === s}
                  onClick={() => setParam("status", s)}>
            {t(s ? `status.${s}` : "status.all")}
          </button>
        ))}
      </div>

      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setPage(1); setParam("q", q.trim()); }}>
        <input className="input grow" type="search" placeholder={t("people.search")} aria-label={t("people.search")}
               value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" aria-label={t("people.country")} value={country}
                onChange={(e) => { setCountry(e.target.value); setParam("country", e.target.value); }}>
          <option value="">{t("people.country")}: {t("status.all")}</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c[lang]}</option>)}
        </select>
        {role === "driver" && (
          <select className="select" aria-label={t("people.category")} value={category}
                  onChange={(e) => { setCategory(e.target.value); setParam("category", e.target.value); }}>
            <option value="">{t("people.category")}: {t("status.all")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
          </select>
        )}
        <button className="btn btn-primary">{t("action.search")}</button>
      </form>

      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="table-wrap">
          {data.items.length === 0 ? (
            <div className="empty"><p>{t(status === "pending" ? "people.empty.pending" : "people.empty")}</p></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t("field.full_name")}</th>
                  <th>{t("field.status")}</th>
                  <th>{t("people.country")}</th>
                  {role === "driver" && <th>{t("people.vehicle")}</th>}
                  {role === "driver" && <th>{t("people.category")}</th>}
                  <th>{status === "pending" ? t("people.submitted") : t("people.joined")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="row-link" tabIndex={0}
                      onClick={() => router.push(`${base}/${u.id}`)}
                      onKeyDown={(e) => e.key === "Enter" && router.push(`${base}/${u.id}`)}>
                    <td>
                      <div className="cell-strong">{u.full_name ?? "—"}</div>
                      <div className="cell-sub num">{phone(u.phone)}</div>
                    </td>
                    <td><StatusBadge status={u.status} /></td>
                    <td>
                      <div>{COUNTRIES.find((c) => c.code === u.country)?.[lang] ?? u.country}</div>
                      <div className="cell-sub">{u.city ?? ""}</div>
                    </td>
                    {role === "driver" && (
                      <td>
                        {u.vehicle ? (
                          <>
                            <div>{u.vehicle.make} {u.vehicle.model}, {u.vehicle.year}</div>
                            <div className="cell-sub num">{u.vehicle.plate_number}</div>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                    )}
                    {role === "driver" && <td><CategoryTag category={u.driver?.category} /></td>}
                    <td className="num">{ago(status === "pending" ? u.submitted_at : u.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {data && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
    </>
  );
}
