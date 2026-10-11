"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError, post } from "@/lib/api";
import { dateTime, phone } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { CATEGORIES, COUNTRIES, type Category, type DocMeta, type UserDetail } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useToast } from "./Toast";
import { CategoryTag, ErrorNote, Loading, StatusBadge, errorKey, useSecureFile } from "./ui";

const REASON_REQUIRED = new Set(["reject", "suspend", "ban"]);
const ACTION_STYLE: Record<string, string> = {
  approve: "btn-primary",
  reinstate: "btn-primary",
  reject: "btn-warn-outline",
  suspend: "btn-secondary",
  ban: "btn-danger-outline",
};

function expectedDocs(u: UserDetail): string[] {
  const docs = ["selfie", "id_front"];
  if (u.id_type !== "passport") docs.push("id_back");
  if (u.role === "driver") docs.push("license", "vehicle_front", "insurance");
  return docs;
}

export function UserReview({ id, role }: { id: string; role: "driver" | "rider" }) {
  const { t, lang } = useI18n();
  const { data: u, error, loading, setData } = useApi<UserDetail>(`/admin/users/${id}`);
  const [action, setAction] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DocMeta | null>(null);

  const docsByType = useMemo(() => {
    const m = new Map<string, DocMeta[]>();
    for (const d of u?.documents ?? []) m.set(d.doc_type, [...(m.get(d.doc_type) ?? []), d]);
    return m;
  }, [u]);

  if (loading && !u) return <Loading />;
  if (!u) return <ErrorNote error={error} />;

  const back = role === "driver" ? "/drivers" : "/riders";
  const selfie = docsByType.get("selfie")?.[0] ?? null;
  const extras = [...(docsByType.get("vehicle_extra") ?? []), ...(docsByType.get("other") ?? [])];
  const country = COUNTRIES.find((c) => c.code === u.country)?.[lang] ?? u.country;

  return (
    <>
      <Link href={`${back}?status=pending`} className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
        ‹ {t("action.back")}
      </Link>

      <div className="page-head">
        <div className="identity-strip">
          <div className="avatar"><SecureThumb file={selfie} alt={t("doc.selfie")} /></div>
          <div>
            <h1>{u.full_name ?? phone(u.phone)}</h1>
            <p className="muted num" style={{ fontSize: "1.0625rem" }}>
              {phone(u.phone)}{u.city ? `, ${u.city}` : ""}{country ? `, ${country}` : ""}
            </p>
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={u.status} />
              {u.driver && <CategoryTag category={u.driver.category} />}
              {u.driver && u.status === "approved" && (
                <span className="muted">{t(u.driver.online ? "detail.online" : "detail.offline")}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="review">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>{t("detail.documents")}</h2></div>
            <div className="docs">
              {expectedDocs(u).map((type) => {
                const doc = docsByType.get(type)?.[0];
                return doc ? (
                  <DocCard key={type} doc={doc} label={t(`doc.${type}`)} onOpen={() => setViewing(doc)} />
                ) : (
                  <div key={type} className="doc doc-missing">
                    <div className="doc-media">{lang === "fr" ? "Manquant" : "Missing"}</div>
                    <div className="doc-caption">{t(`doc.${type}`)}</div>
                  </div>
                );
              })}
              {extras.map((doc) => (
                <DocCard key={doc.id} doc={doc} label={t(`doc.${doc.doc_type}`)} onOpen={() => setViewing(doc)} />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>{t("detail.identity")}</h2></div>
            <dl className="dl">
              <dt>{t("field.full_name")}</dt><dd>{u.full_name ?? "—"}</dd>
              <dt>{t("field.phone")}</dt><dd className="num">{phone(u.phone)}</dd>
              <dt>{t("field.email")}</dt><dd>{u.email ?? "—"}</dd>
              <dt>{t("field.dob")}</dt><dd>{u.date_of_birth ?? "—"}</dd>
              <dt>{t("field.id_type")}</dt><dd>{u.id_type ? t(`id_type.${u.id_type}`) : "—"}</dd>
              <dt>{t("field.id_number")}</dt><dd className="num">{u.id_number ?? "—"}</dd>
              {role === "driver" && (<><dt>{t("field.license_number")}</dt><dd className="num">{u.license_number ?? "—"}</dd></>)}
              <dt>{t("people.joined")}</dt><dd>{dateTime(u.created_at, lang)}</dd>
              <dt>{t("people.submitted")}</dt><dd>{dateTime(u.submitted_at, lang)}</dd>
            </dl>
            <p className="muted" style={{ marginTop: 14 }}>
              {u.consent ? t("detail.consent", { date: dateTime(u.consent.accepted_at, lang) }) : t("detail.noConsent")}
            </p>
          </section>

          {role === "driver" && (
            <div className="grid-2" style={{ marginTop: 16 }}>
              <section className="panel" style={{ marginTop: 0 }}>
                <div className="panel-head"><h2>{t("detail.vehicle")}</h2></div>
                {u.vehicle ? (
                  <dl className="dl">
                    <dt>{t("field.type")}</dt><dd>{t(`vehicle.${u.vehicle.type}`)}</dd>
                    <dt>{t("field.make")}</dt><dd>{u.vehicle.make}</dd>
                    <dt>{t("field.model")}</dt><dd>{u.vehicle.model || "—"}</dd>
                    <dt>{t("field.year")}</dt><dd className="num">{u.vehicle.year}</dd>
                    <dt>{t("field.color")}</dt><dd>{u.vehicle.color}</dd>
                    <dt>{t("field.plate")}</dt><dd className="num">{u.vehicle.plate_number}</dd>
                  </dl>
                ) : <p className="muted">—</p>}
              </section>
              <section className="panel" style={{ marginTop: 0 }}>
                <div className="panel-head"><h2>{t("detail.payout")}</h2></div>
                {u.payout ? (
                  <dl className="dl">
                    <dt>{t("field.method")}</dt><dd>{u.payout.method.replace(/_/g, " ")}</dd>
                    <dt>{t("field.account_name")}</dt><dd>{u.payout.account_name}</dd>
                    <dt>{t("field.account_number")}</dt><dd className="num">{u.payout.account_number}</dd>
                    {u.payout.bank_name && (<><dt>Bank</dt><dd>{u.payout.bank_name}</dd></>)}
                  </dl>
                ) : <p className="muted">—</p>}
              </section>
            </div>
          )}

          <section className="panel">
            <div className="panel-head"><h2>{t("detail.history")}</h2></div>
            {u.history.length === 0 ? <p className="muted">—</p> : (
              <ol className="timeline">
                {u.history.map((h) => (
                  <li key={h.id}>
                    <div>
                      <div className="cell-strong">{h.action}</div>
                      <div className="cell-sub">{dateTime(h.created_at, lang)}, {h.actor_name ?? h.actor_role}</div>
                      {h.reason && <div>{h.reason}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="review-aside">
          <section className={`decision ${u.status === "pending" ? "decision-pending" : ""}`}>
            <h2>{t("detail.decision")}</h2>
            {u.review && (
              <p className="muted">
                {t("detail.lastReview", { action: t(`action.${u.review.action}`), by: u.review.by_name ?? "—" })}
                {u.review.reason ? `: ${u.review.reason}` : ""}
              </p>
            )}
            {u.allowed_actions.length === 0 && <p className="muted">{t("detail.noActions")}</p>}
            {u.allowed_actions.map((a) => (
              <button key={a} className={`btn btn-block ${a === "approve" ? "btn-lg" : ""} ${ACTION_STYLE[a] ?? "btn-secondary"}`}
                      onClick={() => setAction(a)}>
                {t(`action.${a}`)}
              </button>
            ))}
          </section>

          {role === "driver" && u.driver && (
            <CategoryPanel user={u} onSaved={(next) => setData(next)} />
          )}
        </aside>
      </div>

      {action && (
        <DecisionDialog user={u} action={action} onClose={() => setAction(null)}
                        onDone={(next) => { setData(next); setAction(null); }} />
      )}
      {viewing && <Lightbox doc={viewing} label={t(`doc.${viewing.doc_type}`)} onClose={() => setViewing(null)} />}
    </>
  );
}

function SecureThumb({ file, alt }: { file: DocMeta | null; alt: string }) {
  const { url } = useSecureFile(file?.id ?? null);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt} /> : null;
}

function DocCard({ doc, label, onOpen }: { doc: DocMeta; label: string; onOpen: () => void }) {
  const { t } = useI18n();
  const { url, failed } = useSecureFile(doc.id);
  const isPdf = doc.content_type === "application/pdf";
  return (
    <div className="doc">
      <button className={`doc-media ${doc.doc_type === "selfie" ? "selfie" : ""}`} onClick={onOpen}
              style={{ border: 0, padding: 0, cursor: "zoom-in", width: "100%" }} aria-label={`${t("doc.open")}: ${label}`}>
        {failed ? "!" : isPdf ? <span style={{ fontWeight: 800, fontSize: "1.5rem" }}>PDF</span>
          // eslint-disable-next-line @next/next/no-img-element
          : url ? <img src={url} alt={label} /> : null}
      </button>
      <div className="doc-caption">{label}</div>
    </div>
  );
}

function Lightbox({ doc, label, onClose }: { doc: DocMeta; label: string; onClose: () => void }) {
  const { t } = useI18n();
  const { url } = useSecureFile(doc.id);
  const isPdf = doc.content_type === "application/pdf";
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}
         onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="lightbox-bar">
        {url && isPdf && <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">{t("doc.open")}</a>}
        <button className="btn btn-secondary" onClick={onClose} autoFocus>{t("action.done")}</button>
      </div>
      {url && (isPdf
        ? <iframe src={url} title={label} style={{ width: "min(900px, 100%)", height: "80vh", border: 0, background: "#fff" }}
                  onClick={(e) => e.stopPropagation()} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={url} alt={label} onClick={(e) => e.stopPropagation()} />)}
    </div>
  );
}

function DecisionDialog({ user, action, onClose, onDone }: {
  user: UserDetail; action: string; onClose: () => void; onDone: (u: UserDetail) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = REASON_REQUIRED.has(action);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await post<UserDetail>(`/admin/users/${user.id}/status`, { action, reason: reason.trim() || null });
      toast(t(`decision.done.${action}`));
      onDone(next);
    } catch (err) {
      const conflict = err instanceof ApiError && err.code === "status_changed";
      setError(conflict ? (t("error.generic")) : t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title"
            onSubmit={confirm} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2 id="decision-title">{t(`decision.title.${action}`)}</h2>
        <p className="muted">{user.full_name}, {phone(user.phone)}</p>
        {needsReason && (
          <div className="field">
            <label htmlFor="reason">{t("decision.reason")}</label>
            <textarea id="reason" className="textarea" value={reason} required autoFocus
                      onChange={(e) => setReason(e.target.value)} maxLength={500} />
            <span className="hint">{t("decision.reasonHint")}</span>
          </div>
        )}
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t("action.cancel")}</button>
          <button className={`btn ${action === "ban" ? "btn-danger" : "btn-primary"}`}
                  disabled={busy || (needsReason && !reason.trim())} autoFocus={!needsReason}>
            {t(`action.${action}`)}
          </button>
        </div>
      </form>
    </div>
  );
}

function CategoryPanel({ user, onSaved }: { user: UserDetail; onSaved: (u: UserDetail) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const d = user.driver!;
  const isMoto = user.vehicle?.type === "moto";
  const options = CATEGORIES.filter((c) => (isMoto ? c === "moto" : c !== "moto"));
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<Category>(d.category ?? options[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await post<UserDetail>(`/admin/users/${user.id}/category`, { category, reason: reason.trim() });
      toast(t("detail.categorySaved"));
      setEditing(false);
      setReason("");
      onSaved(next);
    } catch (err) {
      toast(t(errorKey(err)), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: 0 }}>
      <div className="panel-head">
        <h2>{t("detail.category")}</h2>
        <CategoryTag category={d.category} />
      </div>
      {d.suggested_category && (
        <p className="muted">{t("detail.suggested", { cat: t(`cat.${d.suggested_category}`) })}</p>
      )}
      {d.category_reasons && d.category_reasons.length > 0 && (
        <p className="muted" style={{ fontSize: "0.875rem" }}>{d.category_reasons.join("; ")}</p>
      )}
      {d.category_source === "admin" && <p className="cell-strong" style={{ marginTop: 6 }}>{t("detail.overridden")}</p>}
      {!editing ? (
        <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => setEditing(true)}
                disabled={!user.vehicle}>
          {t("detail.changeCategory")}
        </button>
      ) : (
        <form onSubmit={save} style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div role="radiogroup" aria-label={t("detail.category")} style={{ display: "grid", gap: 6 }}>
            {options.map((c) => (
              <label key={c} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 40, cursor: "pointer" }}>
                <input type="radio" name="cat" value={c} checked={category === c} onChange={() => setCategory(c)}
                       style={{ width: 20, height: 20 }} />
                <CategoryTag category={c} />
              </label>
            ))}
          </div>
          <div className="field">
            <label htmlFor="cat-reason">{t("detail.categoryReason")}</label>
            <textarea id="cat-reason" className="textarea" value={reason} required minLength={3}
                      onChange={(e) => setReason(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>{t("action.cancel")}</button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || reason.trim().length < 3}>
              {t("action.save")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
