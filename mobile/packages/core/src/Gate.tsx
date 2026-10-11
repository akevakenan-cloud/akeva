import { useState } from "react";
import { Text } from "react-native";
import type { AppRole } from "./config";
import { useI18n } from "./i18n";
import { Onboarding } from "./Onboarding";
import { PhoneLogin } from "./PhoneLogin";
import { useSession } from "./session";
import { colors, type } from "./theme";
import { Banner, Body, Button, Display, Loading, Muted, Screen } from "./ui";

/**
 * Decides what the app shows: sign-in, registration, review status, or the
 * app itself once the account is approved. Approval is re-checked from the
 * server, so a suspension takes effect the next time the app talks to Akeva.
 */
export function Gate({ role, children }: { role: AppRole; children: React.ReactNode }) {
  const { ready, me } = useSession();
  const [fixing, setFixing] = useState(false);
  if (!ready) return <Loading />;
  if (!me) return <PhoneLogin role={role} />;
  if (me.status === "approved") return <>{children}</>;
  if (me.status === "onboarding" || (me.status === "rejected" && fixing)) return <Onboarding />;
  return <ReviewStatus onFix={() => setFixing(true)} />;
}

function ReviewStatus({ onFix }: { onFix: () => void }) {
  const { t } = useI18n();
  const { me, refresh, signOut, offline } = useSession();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const s = me.status;
  return (
    <Screen>
      <Text style={{ fontSize: 56 }}>{s === "pending" ? "⏳" : s === "rejected" ? "✍️" : "⛔"}</Text>
      <Display>{t(s === "pending" ? "review.pendingTitle" : s === "rejected" ? "review.rejectedTitle"
        : s === "suspended" ? "review.suspendedTitle" : "review.bannedTitle")}</Display>
      {s === "pending" ? <Body>{t("review.pendingBody")}</Body> : null}
      {me.review?.reason && s !== "pending" ? (
        <Banner kind={s === "rejected" ? "warn" : "error"}>{t("review.rejectedBody", { reason: me.review.reason })}</Banner>
      ) : null}
      {offline ? <Banner kind="warn">{t("common.offline")}</Banner> : null}
      {s === "rejected" ? <Button title={t("review.fix")} onPress={onFix} /> : null}
      <Button variant="secondary" title={t("review.refresh")} loading={busy}
              onPress={async () => { setBusy(true); await refresh(); setBusy(false); }} />
      {s === "suspended" || s === "banned" ? <Muted>{t("review.contact")}</Muted> : null}
      <Button variant="ghost" title={t("common.signOut")} onPress={signOut} />
      <Text style={[type.muted, { color: colors.ink3, marginTop: "auto" }]}>{me.phone}</Text>
    </Screen>
  );
}
