"use client";

import { useEffect, useMemo, useState } from "react";
import { post, put, qs } from "@/lib/api";
import { xaf } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { CATEGORIES, COUNTRIES, type Category } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CategoryTag, ErrorNote, errorKey } from "@/components/ui";
import { useToast } from "@/components/Toast";

type Rule = {
  id?: string; country: string; city_id: string | null; category: Category;
  base_fare: number; per_km: number; per_minute: number; minimum_fare: number;
  multiplier: number; booking_fee: number; commission_rate: number; rounding_step: number;
};
type City = { id: string; country: string; name: string; active: boolean };
type Preview = { rule_source: "city" | "country" | "default"; fare: { total: number; driver_earnings: number; commission: number } };

const FIELDS = ["base_fare", "per_km", "per_minute", "minimum_fare", "multiplier", "commission_rate"] as const;
const LABEL_KEY: Record<(typeof FIELDS)[number], string> = {
  base_fare: "pricing.base", per_km: "pricing.perKm", per_minute: "pricing.perMin",
  minimum_fare: "pricing.min", multiplier: "pricing.multiplier", commission_rate: "pricing.commission",
};
const DEFAULT_MULT: Record<Category, number> = { moto: 1, economy: 1, comfort: 1.3, prestige: 1.6, gold: 2.2, platinum: 3 };

function blankRule(country: string, cityId: string | null, category: Category): Rule {
  const moto = category === "moto";
  return {
    country, city_id: cityId, category,
    base_fare: moto ? 200 : 500, per_km: moto ? 100 : 250, per_minute: moto ? 10 : 25,
    minimum_fare: moto ? 300 : 1000, multiplier: DEFAULT_MULT[category],
    booking_fee: 0, commission_rate: 0.15, rounding_step: 50,
  };
}

export default function PricingPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [country, setCountry] = useState("CM");
  const [cityId, setCityId] = useState<string>("");
  const { data: rules, error, reload } = useApi<Rule[]>(`/admin/pricing${qs({ country })}`);
  const { data: cities } = useApi<City[]>(`/admin/cities${qs({ country })}`);
  const [draft, setDraft] = useState<Record<string, Rule>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => setCityId(""), [country]);

  // Rows for the selected scope: the stored rule, or a draft prefilled with defaults.
  const rows = useMemo(() => {
    const scope = cityId || null;
    return CATEGORIES.map((cat) => {
      const stored = rules?.find((r) => r.category === cat && (r.city_id ?? null) === scope);
      return { cat, stored: Boolean(stored), rule: draft[`${scope}:${cat}`] ?? stored ?? blankRule(country, scope, cat) };
    });
  }, [rules, draft, cityId, country]);

  function edit(cat: Category, field: keyof Rule, value: number) {
    const scope = cityId || null;
    const current = rows.find((r) => r.cat === cat)!.rule;
    setDraft((d) => ({ ...d, [`${scope}:${cat}`]: { ...current, [field]: value } }));
  }

  async function save(rule: Rule) {
    const key = `${rule.city_id}:${rule.category}`;
    setSaving(key);
    try {
      // Send only the editable fields; stored rules also carry id/updated_at, which the API rejects.
      const body = {
        country: rule.country, city_id: rule.city_id, category: rule.category,
        base_fare: rule.base_fare, per_km: rule.per_km, per_minute: rule.per_minute,
        minimum_fare: rule.minimum_fare, multiplier: rule.multiplier, booking_fee: rule.booking_fee,
        commission_rate: rule.commission_rate, rounding_step: rule.rounding_step,
      };
      await put("/admin/pricing", body);
      setDraft((d) => {
        const next = { ...d };
        delete next[`${cityId || null}:${rule.category}`];
        return next;
      });
      toast(t("pricing.saved"));
      reload();
    } catch (e) {
      toast(t(errorKey(e)), true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("pricing.title")}</h1>
          <p className="muted" style={{ maxWidth: "70ch" }}>{t("pricing.hint")}</p>
        </div>
      </div>

      <div className="toolbar">
        <select className="select" aria-label={t("people.country")} value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c[lang]}</option>)}
        </select>
        <select className="select" aria-label={t("pricing.scope")} value={cityId} onChange={(e) => setCityId(e.target.value)}>
          <option value="">{t("pricing.countryWide")}</option>
          {cities?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <ErrorNote error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("people.category")}</th>
              {FIELDS.map((f) => <th key={f}>{t(LABEL_KEY[f])}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cat, stored, rule }) => {
              const dirty = Boolean(draft[`${cityId || null}:${cat}`]);
              return (
                <tr key={cat}>
                  <td>
                    <CategoryTag category={cat} />
                    {!stored && <div className="cell-sub">{t("pricing.source.default")}</div>}
                  </td>
                  {FIELDS.map((f) => (
                    <td key={f}>
                      <input className="input num" style={{ width: f === "multiplier" || f === "commission_rate" ? 90 : 110, minHeight: 42 }}
                             type="number" min={0} step={f === "multiplier" ? 0.1 : f === "commission_rate" ? 1 : 25}
                             aria-label={`${t(`cat.${cat}`)}: ${t(LABEL_KEY[f])}`}
                             value={f === "commission_rate" ? Math.round(rule.commission_rate * 100) : rule[f]}
                             onChange={(e) => {
                               const v = Number(e.target.value);
                               edit(cat, f, f === "commission_rate" ? v / 100 : v);
                             }} />
                    </td>
                  ))}
                  <td>
                    <button className="btn btn-primary btn-sm" disabled={(!dirty && stored) || saving !== null}
                            onClick={() => save(rule)}>
                      {t("action.save")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FarePreview country={country} cityId={cityId || null} />
    </>
  );
}

function FarePreview({ country, cityId }: { country: string; cityId: string | null }) {
  const { t, lang } = useI18n();
  const [category, setCategory] = useState<Category>("economy");
  const [distance, setDistance] = useState(8);
  const [duration, setDuration] = useState(20);
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(await post<Preview>("/admin/pricing/preview", {
        country, city_id: cityId, category, distance_km: distance, duration_min: duration,
      }));
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>{t("pricing.preview")}</h2></div>
      <form className="toolbar" onSubmit={run} style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label htmlFor="pv-cat">{t("people.category")}</label>
          <select id="pv-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pv-km">{t("pricing.distance")}</label>
          <input id="pv-km" className="input num" type="number" min={0} step={0.1} value={distance}
                 onChange={(e) => setDistance(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="pv-min">{t("pricing.duration")}</label>
          <input id="pv-min" className="input num" type="number" min={0} value={duration}
                 onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <button className="btn btn-primary">{t("pricing.preview")}</button>
      </form>
      {error && <p className="alert">{error}</p>}
      {result && (
        <dl className="dl" style={{ maxWidth: 420 }}>
          <dt>{t("pricing.total")}</dt><dd className="num" style={{ fontSize: "1.375rem" }}>{xaf(result.fare.total, lang)}</dd>
          <dt>{t("pricing.driverGets")}</dt><dd className="num">{xaf(result.fare.driver_earnings, lang)}</dd>
          <dt>{t("finance.commission")}</dt><dd className="num">{xaf(result.fare.commission, lang)}</dd>
          <dt>{t("pricing.scope")}</dt><dd>{t(`pricing.source.${result.rule_source}`)}</dd>
        </dl>
      )}
    </section>
  );
}
