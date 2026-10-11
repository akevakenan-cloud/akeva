"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { errorKey } from "@/components/ui";

type Channel = "sms" | "whatsapp";
type RequestOut = {
  sent: boolean; phone: string; expires_in: number; dev_code?: string;
  channel: Channel; alternate_channel: Channel | null;
};
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
  const [channel, setChannel] = useState<Channel>("sms");
  const [alternate, setAlternate] = useState<Channel | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("expired") ? "error.session" : null);

  useEffect(() => {
    if (ready && user) router.replace("/overview");
  }, [ready, user, router]);

  async function sendCode(via?: Channel) {
    setBusy(true);
    setError(null);
    try {
      const out = await post<RequestOut>("/auth/otp/request", {
        phone: sentTo ?? phone, app: "admin", language: lang, ...(via ? { channel: via } : {}),
      });
      setSentTo(out.phone);
      setDevCode(out.dev_code ?? null);
      setChannel(out.channel);
      // Offer the other channel only once; after a switch the user waits for the normal resend.
      setAlternate(via ? null : out.alternate_channel);
      setCode("");
    } catch (err) {
      const errCode = err instanceof ApiError ? err.code : "";
      setError(errCode === "invalid_phone" ? "login.phoneHint"
        : errCode === "otp_resend_too_soon" ? "login.wait"
        : errCode === "sms_unavailable" ? "login.undelivered"
        : errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  function requestCode(e: React.FormEvent) {
    e.preventDefault();
    sendCode();
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
            <p className="muted">{t(channel === "whatsapp" ? "login.sentWhatsApp" : "login.sentSms", { phone: sentTo })}</p>
            {devCode && <p className="alert alert-warn">{t("login.devCode", { code: devCode })}</p>}
            <input className="input input-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                   aria-label={t("login.code")} value={code} autoFocus
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
            {error && <p className="alert" role="alert">{t(error)}</p>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length < 4}>
              {t("login.verify")}
            </button>
            {alternate && (
              <button type="button" className="btn btn-secondary btn-block" disabled={busy}
                      onClick={() => sendCode(alternate)}>
                {t(alternate === "whatsapp" ? "login.viaWhatsApp" : "login.viaSms")}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => { setSentTo(null); setCode(""); setAlternate(null); }}>
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
