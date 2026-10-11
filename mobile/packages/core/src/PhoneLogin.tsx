import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ApiError, post } from "./api";
import { COUNTRIES, type AppRole, type CountryCode } from "./config";
import { phone as fmtPhone } from "./format";
import { useI18n } from "./i18n";
import { useSession } from "./session";
import { colors, radius, space, type } from "./theme";
import { Banner, Button, Display, Field, Muted, Row, Screen } from "./ui";

type Channel = "sms" | "whatsapp";
type RequestOut = { phone: string; channel: Channel; alternate_channel: Channel | null; dev_code?: string };
type VerifyOut = { access_token: string; refresh_token: string };

const RESEND_SECONDS = 60;

export function PhoneLogin({ role }: { role: AppRole }) {
  const { t, lang, setLang } = useI18n();
  const { signIn } = useSession();
  const [country, setCountry] = useState<CountryCode>("CM");
  const [number, setNumber] = useState("");
  const [sent, setSent] = useState<RequestOut | null>(null);
  const [switched, setSwitched] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const dial = COUNTRIES.find((c) => c.code === country)!.dial;

  async function send(via?: Channel) {
    setBusy(true);
    setError(null);
    try {
      const out = await post<RequestOut>("/auth/otp/request", {
        phone: sent?.phone ?? number, country, app: role, language: lang, ...(via ? { channel: via } : {}),
      });
      setSent(out);
      setCode("");
      setWait(RESEND_SECONDS);
      if (via) setSwitched(true);
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "";
      setError(c === "invalid_phone" ? t("login.invalidPhone")
        : c === "otp_resend_too_soon" || c === "rate_limited" ? t("login.wait")
        : c === "sms_unavailable" ? t("login.undelivered")
        : c === "network" ? t("common.network") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!sent) return;
    setBusy(true);
    setError(null);
    try {
      const out = await post<VerifyOut>("/auth/otp/verify", { phone: sent.phone, app: role, code });
      await signIn(out.access_token, out.refresh_token);
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "";
      setError(c === "account_banned" ? t("login.banned") : c === "network" ? t("common.network") : t("login.wrongCode"));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen>
        <Display>{t("login.code")}</Display>
        <Muted>{t(sent.channel === "whatsapp" ? "login.sentWhatsApp" : "login.sentSms", { phone: fmtPhone(sent.phone) })}</Muted>
        {sent.dev_code ? <Banner kind="warn">{t("login.devCode", { code: sent.dev_code })}</Banner> : null}
        <Field label={t("login.code")} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
               keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" autoFocus
               style={{ fontSize: 30, letterSpacing: 12, textAlign: "center" }} />
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button title={t("login.verify")} onPress={verify} loading={busy} disabled={code.length < 6} />
        {sent.alternate_channel && !switched ? (
          <Button variant="secondary" title={t(sent.alternate_channel === "whatsapp" ? "login.viaWhatsApp" : "login.viaSms")}
                  onPress={() => send(sent.alternate_channel!)} disabled={busy} />
        ) : wait > 0 ? (
          <Muted style={{ textAlign: "center" }}>{t("login.resendIn", { s: wait })}</Muted>
        ) : (
          <Button variant="secondary" title={t("login.resend")} onPress={() => send()} disabled={busy} />
        )}
        <Button variant="ghost" title={t("login.change")} onPress={() => { setSent(null); setSwitched(false); }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.white, fontSize: 24, fontWeight: "900" }}>A</Text>
        </View>
        <Row>
          {(["fr", "en"] as const).map((l) => (
            <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="button" accessibilityState={{ selected: lang === l }}
                       style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm,
                                backgroundColor: lang === l ? colors.ink : "transparent" }}>
              <Text style={{ fontWeight: "800", color: lang === l ? colors.white : colors.ink }}>{l.toUpperCase()}</Text>
            </Pressable>
          ))}
        </Row>
      </Row>
      <Display>{t(role === "rider" ? "login.welcomeRider" : "login.welcomeDriver")}</Display>

      <Text style={type.label}>{t("login.country")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {COUNTRIES.map((c) => (
          <Pressable key={c.code} onPress={() => setCountry(c.code)} accessibilityRole="radio"
                     accessibilityState={{ selected: country === c.code }}
                     style={{ paddingHorizontal: 14, minHeight: 48, justifyContent: "center", borderRadius: radius.pill, borderWidth: 2,
                              borderColor: country === c.code ? colors.forest : colors.line,
                              backgroundColor: country === c.code ? colors.forestTint : colors.surface }}>
            <Text style={{ fontWeight: "700", color: colors.ink }}>{c[lang]} {c.dial}</Text>
          </Pressable>
        ))}
      </View>

      <Field label={t("login.phone")} value={number} onChangeText={setNumber} keyboardType="phone-pad"
             textContentType="telephoneNumber" autoComplete="tel" placeholder={`${dial} …`} />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button title={t("login.send")} onPress={() => send()} loading={busy} disabled={number.replace(/\D/g, "").length < 7} />
      <Muted>{t("login.notice")}</Muted>
    </Screen>
  );
}
