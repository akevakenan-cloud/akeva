"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { errorKey } from "@/components/ui";

type RequestOut = { sent: boolean; phone: string; expires_in: number; dev_code?: string };
type VerifyOut = { access_token: string; refresh_token: string };

const COUNTRY_CHIPS = ["Cameroun", "Tchad", "Gabon", "Guinée Équatoriale", "Centrafrique", "Congo"];

function LoginForm() {
  const { t, lang, setLang } = useI18n();
  const { user, ready, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [phone, setPhone] = useState("+237 ");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("expired") ? "error.session" : null);

  useEffect(() => {
    if (ready && user) router.replace("/overview");
  }, [ready, user, router]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await post<RequestOut>("/auth/otp/request", { phone, app: "admin", language: lang });
      setSentTo(out.phone);
      setDevCode(out.dev_code ?? null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "invalid_phone" ? "login.phoneHint" : errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    try {
      const out = await post<VerifyOut>("/auth/otp/verify", { phone: sentTo, app: "admin", code });
      await signIn(out.access_token, out.refresh_token);
      router.replace("/overview");
    } catch (err) {
      setError(err instanceof ApiError && (err.status === 400 || err.status === 429) ? "login.wrongCode" : errorKey(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-art" aria-hidden="true">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">A</div>
          <span className="brand-name">Akeva</span>
        </div>
        <h1>{lang === "fr" ? "Chaque course commence par un compte vérifié." : "Every ride starts with a verified account."}</h1>
        <div className="login-countries">
          {COUNTRY_CHIPS.map((c) => <span key={c}>{c}</span>)}
        </div>
      </section>

      <section className="login-form">
        {!sentTo ? (
          <form onSubmit={requestCode}>
            <h2>{t("login.title")}</h2>
            <div className="field">
              <label htmlFor="phone">{t("login.phone")}</label>
              <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel"
                     value={phone} onChange={(e) => setPhone(e.target.value)} required />
              <span className="hint">{t("login.phoneHint")}</span>
            </div>
            {error && <p className="alert" role="alert">{t(error)}</p>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{t("login.send")}</button>
            <div className="lang-switch" style={{ maxWidth: 160 }}>
              {(["fr", "en"] as const).map((l) => (
                <button key={l} type="button" className="btn btn-secondary btn-sm" aria-pressed={lang === l}
                        onClick={() => setLang(l)}>{l.toUpperCase()}</button>
              ))}
            </div>
          </form>
        ) : (
          <form onSubmit={verify}>
            <h2>{t("login.code")}</h2>
            <p className="muted">{t("login.sentTo", { phone: sentTo })}</p>
            {devCode && <p className="alert alert-warn">{t("login.devCode", { code: devCode })}</p>}
            <input className="input input-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                   aria-label={t("login.code")} value={code} autoFocus
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
            {error && <p className="alert" role="alert">{t(error)}</p>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length < 4}>
              {t("login.verify")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setSentTo(null); setCode(""); }}>
              {t("login.change")}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
