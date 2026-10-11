"use client";

import { useState } from "react";
import { post } from "@/lib/api";
import { dateTime, phone } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { User } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, StatusBadge, errorKey } from "@/components/ui";
import { useToast } from "@/components/Toast";

export default function StaffPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<User[]>(user?.role === "super_admin" ? "/admin/staff" : null);
  const [form, setForm] = useState({ phone: "+237 ", full_name: "", role: "admin" });

  if (user?.role !== "super_admin") return <p className="alert">403</p>;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/admin/staff", form);
      toast(t("staff.added"));
      setForm({ phone: "+237 ", full_name: "", role: "admin" });
      reload();
    } catch (err) {
      toast(t(errorKey(err)), true);
    }
  }

  async function suspend(member: User) {
    const reason = window.prompt(t("decision.reason"));
    if (!reason) return;
    try {
      await post(`/admin/users/${member.id}/status`, { action: member.status === "approved" ? "suspend" : "reinstate", reason });
      reload();
    } catch (err) {
      toast(t(errorKey(err)), true);
    }
  }

  return (
    <>
      <div className="page-head"><h1>{t("staff.title")}</h1></div>
      <form className="panel toolbar" style={{ alignItems: "flex-end" }} onSubmit={add}>
        <div className="field grow">
          <label htmlFor="s-name">{t("field.full_name")}</label>
          <input id="s-name" className="input" required minLength={2} value={form.full_name}
                 onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-phone">{t("field.phone")}</label>
          <input id="s-phone" className="input" type="tel" required value={form.phone}
                 onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-role">{t("staff.role")}</label>
          <select id="s-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="admin">{t("staff.role.admin")}</option>
            <option value="super_admin">{t("staff.role.super_admin")}</option>
          </select>
        </div>
        <button className="btn btn-primary">{t("action.add")}</button>
      </form>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td><div className="cell-strong">{m.full_name}</div><div className="cell-sub num">{phone(m.phone)}</div></td>
                  <td>{t(`staff.role.${m.role}`)}</td>
                  <td><StatusBadge status={m.status} /></td>
                  <td className="cell-sub">{dateTime(m.created_at, lang)}</td>
                  <td style={{ textAlign: "right" }}>
                    {m.id !== user.id && (
                      <button className="btn btn-secondary btn-sm" onClick={() => suspend(m)}>
                        {t(m.status === "approved" ? "action.suspend" : "action.reinstate")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
