import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, patch, post, put } from "./api";
import { CONSENT_VERSION } from "./config";
import { DocumentSlot } from "./DocumentCapture";
import { useI18n } from "./i18n";
import { useSession, type Me } from "./session";
import { colors, type } from "./theme";
import { Banner, Button, Check, Choice, Field, Muted, Row, Screen, Title } from "./ui";
import { useConfig } from "./useConfig";

type StepId = "identity" | "consent" | "documents" | "vehicle" | "payout" | "review";

/** Registration for both apps; drivers get the vehicle and payout steps as well. */
export function Onboarding() {
  const { me } = useSession();
  const { t } = useI18n();
  const steps: StepId[] = me?.role === "driver"
    ? ["identity", "consent", "documents", "vehicle", "payout", "review"]
    : ["identity", "consent", "documents", "review"];
  const [index, setIndex] = useState(0);
  if (!me) return null;
  const step = steps[index];
  const next = () => setIndex((i) => Math.min(i + 1, steps.length - 1));
  const back = index > 0 ? () => setIndex((i) => i - 1) : undefined;

  return (
    <Screen>
      <Muted>{t("onb.step", { n: index + 1, total: steps.length })}</Muted>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {steps.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= index ? colors.forest : colors.line }} />
        ))}
      </View>
      {step === "identity" && <IdentityStep me={me} onDone={next} />}
      {step === "consent" && <ConsentStep me={me} onDone={next} />}
      {step === "documents" && <DocumentsStep me={me} onDone={next} />}
      {step === "vehicle" && <VehicleStep me={me} onDone={next} />}
      {step === "payout" && <PayoutStep me={me} onDone={next} />}
      {step === "review" && <ReviewStep me={me} onEdit={(s) => setIndex(steps.indexOf(s))} />}
      {back && step !== "review" ? <Button variant="ghost" title={t("common.back")} onPress={back} /> : null}
    </Screen>
  );
}

function useSaver() {
  const { refresh } = useSession();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, onDone: () => void, errorFor?: (e: ApiError) => string | null) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      onDone();
    } catch (e) {
      const custom = e instanceof ApiError ? errorFor?.(e) : null;
      setError(custom ?? (e instanceof ApiError && e.code === "network" ? t("common.network") : t("common.error")));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function IdentityStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const { t, lang } = useI18n();
  const config = useConfig();
  const { busy, error, run } = useSaver();
  const [fullName, setFullName] = useState(me.full_name ?? "");
  const [email, setEmail] = useState(me.email ?? "");
  const [city, setCity] = useState<string | null>(me.city);
  const [idType, setIdType] = useState<"national_id" | "passport" | null>(me.id_type);
  const [idNumber, setIdNumber] = useState("");
  const [license, setLicense] = useState(me.license_number ?? "");
  const cities = config?.countries.find((c) => c.code === me.country)?.cities ?? [];
  const isDriver = me.role === "driver";
  const ok = fullName.trim().length >= 2 && city && idType && (idNumber.trim().length >= 3 || me.id_number)
    && (!isDriver || license.trim().length >= 3);

  function save() {
    const body: Record<string, unknown> = { full_name: fullName.trim(), city, id_type: idType, language: lang };
    if (email.trim()) body.email = email.trim();
    if (idNumber.trim()) body.id_number = idNumber.trim(); // stored encrypted; only sent when changed
    if (isDriver) body.license_number = license.trim();
    run(() => patch("/me", body), onDone);
  }

  return (
    <>
      <Title>{t("onb.identity")}</Title>
      <Field label={t("onb.fullName")} value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" />
      {!isDriver && (
        <Field label={t("onb.email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      )}
      <Choice label={t("onb.city")} value={city} onChange={setCity}
              options={cities.map((c) => ({ value: c.name, label: c.name }))} />
      <Choice label={t("onb.idType")} value={idType} onChange={setIdType}
              options={[{ value: "national_id", label: t("onb.nationalId") }, { value: "passport", label: t("onb.passport") }]} />
      <Field label={t("onb.idNumber")} value={idNumber} onChangeText={setIdNumber} autoCapitalize="characters"
             placeholder={me.id_number ?? undefined} />
      {isDriver && (
        <Field label={t("onb.licenseNumber")} value={license} onChangeText={setLicense} autoCapitalize="characters" />
      )}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button title={t("common.continue")} onPress={save} loading={busy} disabled={!ok} />
    </>
  );
}

function ConsentStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const { t } = useI18n();
  const { busy, error, run } = useSaver();
  const [docs, setDocs] = useState(Boolean(me.consent?.documents));
  const [selfie, setSelfie] = useState(Boolean(me.consent?.selfie));
  return (
    <>
      <Title>{t("onb.consentTitle")}</Title>
      <Text style={type.body}>{t("onb.consentBody")}</Text>
      <Check label={t("onb.consentDocs")} value={docs} onChange={setDocs} />
      <Check label={t("onb.consentSelfie")} value={selfie} onChange={setSelfie} />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button title={t("common.continue")} loading={busy} disabled={!docs || !selfie}
              onPress={() => run(() => put("/me/consent", { documents: docs, selfie, version: CONSENT_VERSION }), onDone)} />
    </>
  );
}

function DocumentsStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const { t } = useI18n();
  const { refresh } = useSession();
  const required = useMemo(() => {
    const list = ["selfie", "id_front"];
    if (me.id_type !== "passport") list.push("id_back");
    if (me.role === "driver") list.push("license", "vehicle_front", "insurance");
    return list;
  }, [me.id_type, me.role]);
  const have = new Set(me.documents.map((d) => d.doc_type));
  const complete = required.every((d) => have.has(d));
  return (
    <>
      <Title>{t("onb.documents")}</Title>
      <Muted>{t("onb.docsHint")}</Muted>
      {required.map((d) => (
        <DocumentSlot key={d} docType={d} done={have.has(d)} allowPdf={d === "insurance" || d === "license"}
                      onUploaded={() => refresh()} />
      ))}
      <Button title={t("common.continue")} onPress={onDone} disabled={!complete} />
    </>
  );
}

function VehicleStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const { t } = useI18n();
  const { busy, error, run } = useSaver();
  const v = me.vehicle;
  const [vtype, setVtype] = useState<"car" | "moto" | null>(v?.type ?? null);
  const [make, setMake] = useState(v?.make ?? "");
  const [model, setModel] = useState(v?.model ?? "");
  const [year, setYear] = useState(v?.year ? String(v.year) : "");
  const [color, setColor] = useState(v?.color ?? "");
  const [plate, setPlate] = useState(v?.plate_number ?? "");
  const [preview, setPreview] = useState<string | null>(me.driver?.suggested_category ?? null);
  const yearNum = Number(year);
  const thisYear = new Date().getFullYear();

  // Show the expected category while the driver types (cheap, no account change).
  useEffect(() => {
    if (!vtype || make.trim().length < 2 || yearNum < 1980 || yearNum > thisYear + 1) return;
    const id = setTimeout(() => {
      post<{ suggested_category: string }>("/vehicles/categorize", { type: vtype, make, model, year: yearNum })
        .then((r) => setPreview(r.suggested_category)).catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [vtype, make, model, yearNum, thisYear]);

  const ok = vtype && make.trim().length >= 2 && yearNum >= 1980 && yearNum <= thisYear + 1
    && color.trim().length >= 2 && plate.trim().length >= 3;

  return (
    <>
      <Title>{t("onb.vehicle")}</Title>
      <Choice label={t("onb.vehicleType")} value={vtype} onChange={setVtype}
              options={[{ value: "car", label: t("onb.car") }, { value: "moto", label: t("onb.moto") }]} />
      <Field label={t("onb.make")} value={make} onChangeText={setMake} placeholder="Toyota" />
      <Field label={t("onb.model")} value={model} onChangeText={setModel} placeholder="Corolla" />
      <Field label={t("onb.year")} value={year} onChangeText={(x) => setYear(x.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" />
      <Field label={t("onb.color")} value={color} onChangeText={setColor} />
      <Field label={t("onb.plate")} value={plate} onChangeText={setPlate} autoCapitalize="characters" />
      {preview ? (
        <Banner>{`${t("onb.categoryPreview", { cat: t(`cat.${preview}`) })}\n${t("onb.categoryHint")}`}</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button title={t("common.continue")} loading={busy} disabled={!ok}
              onPress={() => run(
                () => put("/drivers/me/vehicle", { type: vtype, make: make.trim(), model: model.trim(), year: yearNum,
                                                   color: color.trim(), plate_number: plate.trim() }),
                onDone,
                (e) => (e.code === "plate_already_registered" ? t("onb.plateTaken") : null),
              )} />
    </>
  );
}

function PayoutStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const { t } = useI18n();
  const config = useConfig();
  const { busy, error, run } = useSaver();
  const methods = config?.countries.find((c) => c.code === me.country)?.payout_methods ?? ["bank"];
  const [method, setMethod] = useState<string | null>(me.payout?.method ?? null);
  const [name, setName] = useState(me.payout?.account_name ?? me.full_name ?? "");
  const [account, setAccount] = useState("");
  const [bank, setBank] = useState(me.payout?.bank_name ?? "");
  const ok = method && name.trim().length >= 2 && (account.trim().length >= 4 || me.payout);
  return (
    <>
      <Title>{t("onb.payout")}</Title>
      <Choice label={t("onb.payoutMethod")} value={method} onChange={setMethod}
              options={methods.map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
      <Field label={t("onb.accountName")} value={name} onChangeText={setName} />
      <Field label={t("onb.accountNumber")} value={account} onChangeText={setAccount}
             keyboardType={method === "bank" ? "default" : "phone-pad"} placeholder={me.payout?.account_number} />
      {method === "bank" ? <Field label={t("onb.bankName")} value={bank} onChangeText={setBank} /> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button title={t("common.continue")} loading={busy} disabled={!ok}
              onPress={() => (account.trim()
                ? run(() => put("/drivers/me/payout", { method, account_name: name.trim(), account_number: account.trim(),
                                                        ...(method === "bank" ? { bank_name: bank.trim() } : {}) }), onDone)
                : onDone())} />
    </>
  );
}

const FIELD_STEP: Record<string, StepId> = {
  full_name: "identity", id_type: "identity", id_number: "identity", country: "identity", city: "identity",
  license_number: "identity", consent: "consent", payout: "payout",
};

function ReviewStep({ me, onEdit }: { me: Me; onEdit: (s: StepId) => void }) {
  const { t } = useI18n();
  const { busy, error, run } = useSaver();
  const missing = [...me.onboarding.missing_fields, ...me.onboarding.missing_documents.map((d) => `doc:${d}`)];
  const label = (m: string) => (m.startsWith("doc:") ? t(`doc.${m.slice(4)}`) : t(`field.${m}`));
  const stepFor = (m: string): StepId => (m.startsWith("doc:") ? "documents" : m.startsWith("vehicle.") ? "vehicle" : FIELD_STEP[m] ?? "identity");
  return (
    <>
      <Title>{t("onb.review")}</Title>
      {missing.length > 0 ? (
        <>
          <Banner kind="warn">{t("onb.missing")}</Banner>
          {missing.map((m) => (
            <Row key={m} style={{ justifyContent: "space-between" }}>
              <Text style={[type.body, { flex: 1 }]}>• {label(m)}</Text>
              <Button small variant="secondary" title={t("common.continue")} onPress={() => onEdit(stepFor(m))} />
            </Row>
          ))}
        </>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button title={t("onb.submit")} loading={busy} disabled={!me.onboarding.can_submit}
              onPress={() => run(() => post("/me/submit"), () => {})} />
    </>
  );
}
