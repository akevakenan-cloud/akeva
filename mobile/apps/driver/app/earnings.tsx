import {
  ApiError, Banner, Button, Card, Field, Loading, Muted, Row, Screen, Title, colors, get, post, type, useI18n, xaf,
} from "@akeva/core";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

type Period = { rides: number; earnings: number; cash_collected: number };
type Earnings = {
  balance: number;
  summary: { today: Period; week: Period; month: Period };
  payouts: { id: string; amount: number; status: "requested" | "paid" | "rejected"; created_at: string; note: string | null }[];
};

/** Earnings dashboard and withdrawal requests. */
export default function EarningsScreen() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Earnings | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    get<Earnings>("/drivers/me/earnings").then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function withdraw() {
    setBusy(true);
    setMsg(null);
    try {
      await post("/drivers/me/payouts", { amount: Number(amount) });
      setAmount("");
      setMsg({ kind: "info", text: t("driver.withdrawSent") });
      load();
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "";
      setMsg({ kind: "error", text: c === "network" ? t("common.network") : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Loading />;
  const owes = data.balance < 0;
  const pending = data.payouts.some((p) => p.status === "requested");
  const n = Number(amount);

  return (
    <Screen>
      <Title>{t("driver.earnings")}</Title>
      <Row style={{ gap: 8 }}>
        {(["today", "week", "month"] as const).map((k) => (
          <Card key={k} style={{ flex: 1 }}>
            <Muted>{t(`driver.${k}`)}</Muted>
            <Text style={[type.heading, { fontVariant: ["tabular-nums"] }]}>{xaf(data.summary[k].earnings, lang)}</Text>
            <Muted>{t("driver.rides", { n: data.summary[k].rides })}</Muted>
          </Card>
        ))}
      </Row>

      <Card style={owes ? { borderColor: colors.amber, borderWidth: 2 } : undefined}>
        <Muted>{t(owes ? "driver.balanceOwed" : "driver.balance")}</Muted>
        <Text style={type.money}>{xaf(Math.abs(data.balance), lang)}</Text>
        <Muted>{t("driver.balanceHint")}</Muted>
      </Card>

      {data.balance >= 1000 && !pending ? (
        <Card>
          <Field label={t("driver.amount")} value={amount} keyboardType="number-pad"
                 onChangeText={(v) => setAmount(v.replace(/\D/g, ""))} placeholder={String(data.balance)} />
          <Button title={t("driver.withdraw")} onPress={withdraw} loading={busy}
                  disabled={!n || n < 1000 || n > data.balance} />
        </Card>
      ) : null}
      {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}

      {data.payouts.length > 0 ? (
        <>
          <Text style={type.heading}>{t("driver.payouts")}</Text>
          {data.payouts.map((p) => (
            <View key={p.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10,
                                      borderBottomWidth: 1, borderColor: colors.line }}>
              <View>
                <Text style={[type.body, { fontWeight: "700" }]}>{xaf(p.amount, lang)}</Text>
                <Muted>{new Date(p.created_at).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB")}</Muted>
              </View>
              <Text style={[type.body, { fontWeight: "700", color: p.status === "paid" ? colors.forest
                : p.status === "rejected" ? colors.danger : colors.amberInk }]}>{t(`driver.payout.${p.status}`)}</Text>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
