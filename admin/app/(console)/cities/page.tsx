"use client";

import { useState } from "react";
import { patch, post } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { COUNTRIES } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, errorKey } from "@/components/ui";
import { useToast } from "@/components/Toast";

type City = { id: string; country: string; name: string; active: boolean; lat: number; lng: number };

export default function CitiesPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<City[]>("/admin/cities");
  const [form, setForm] = useState({ country: "CM", name: "", lat: "", lng: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post("/admin/cities", { country: form.country, name: form.name.trim(),
        lat: Number(form.lat), lng: Number(form.lng), active: true });
      setForm({ ...form, name: "", lat: "", lng: "" });
      reload();
    } catch (err) {
      toast(t(errorKey(err)), true);
    }
  }

  async function toggle(c: City) {
    try {
      await patch(`/admin/cities/${c.id}`, { active: !c.active });
      reload();
    } catch (err) {
      toast(t(errorKey(err)), true);
    }
  }

  return (
    <>
      <div className="page-head"><h1>{t("cities.title")}</h1></div>
      <form className="panel toolbar" style={{ alignItems: "flex-end" }} onSubmit={add}>
        <div className="field">
          <label htmlFor="c-country">{t("people.country")}</label>
          <select id="c-country" className="select" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c[lang]}</option>)}
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="c-name">{t("cities.name")}</label>
          <input id="c-name" className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="c-lat">{t("cities.lat")}</label>
          <input id="c-lat" className="input num" type="number" step="any" required min={-90} max={90}
                 value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="c-lng">{t("cities.lng")}</label>
          <input id="c-lng" className="input num" type="number" step="any" required min={-180} max={180}
                 value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
        </div>
        <button className="btn btn-primary">{t("action.add")}</button>
      </form>

      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          {data.length === 0 ? <div className="empty"><p>{t("cities.empty")}</p></div> : (
            <table>
              <thead><tr><th>{t("cities.name")}</th><th>{t("people.country")}</th><th>GPS</th><th>{t("field.status")}</th><th /></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-strong">{c.name}</td>
                    <td>{COUNTRIES.find((x) => x.code === c.country)?.[lang]}</td>
                    <td className="num cell-sub">{c.lat.toFixed(4)}, {c.lng.toFixed(4)}</td>
                    <td>{t(c.active ? "cities.active" : "cities.inactive")}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => toggle(c)}>
                        {t(c.active ? "cities.deactivate" : "cities.activate")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
