import {
  ApiError, Banner, Button, Card, Muted, RideMap, Row, colors, get, post, space, type,
  useEvents, useI18n, usePolling, useSession, xaf,
  type Offer, type Ride,
} from "@akeva/core";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDriverTracking } from "../tracking";

/** Online/offline switch and incoming ride offers. */
export default function DriverHome() {
  const { t, lang } = useI18n();
  const { me, refresh } = useSession();
  const [online, setOnline] = useState(Boolean(me?.driver?.online));
  const [offers, setOffers] = useState<Offer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { position, denied } = useDriverTracking(online);

  // Resume a ride in progress.
  useEffect(() => {
    get<Ride | null>("/rides/active").then((r) => r && router.replace("/job")).catch(() => {});
  }, []);

  const loadOffers = useCallback(() => {
    if (online) get<Offer[]>("/drivers/me/offers").then(setOffers).catch(() => {});
  }, [online]);
  usePolling(loadOffers, 6000, online);

  useEvents((e) => {
    if (e.event === "ride.offer") {
      setOffers((list) => (list.some((o) => o.ride_id === e.data.ride_id) ? list : [...list, e.data as Offer]));
    } else if (e.event === "ride.offer_withdrawn") {
      setOffers((list) => list.filter((o) => o.ride_id !== e.data.ride_id));
    }
  }, online);

  // Drop offers once they expire.
  useEffect(() => {
    const id = setInterval(() => setOffers((list) => list.filter((o) => new Date(o.expires_at).getTime() > Date.now())), 2000);
    return () => clearInterval(id);
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await post("/drivers/me/online", { online: !online });
      setOnline(!online);
      if (online) setOffers([]);
      refresh();
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "";
      setError(c === "payout_details_missing" ? t("driver.payoutMissing") : c === "network" ? t("common.network") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function accept(o: Offer) {
    try {
      await post(`/rides/${o.ride_id}/accept`);
      router.replace("/job");
    } catch (e) {
      setOffers((list) => list.filter((x) => x.ride_id !== o.ride_id));
      setError(e instanceof ApiError && e.code === "ride_no_longer_available" ? t("driver.taken") : t("common.error"));
    }
  }

  async function decline(o: Offer) {
    setOffers((list) => list.filter((x) => x.ride_id !== o.ride_id));
    post(`/rides/${o.ride_id}/decline`).catch(() => {});
  }

  const offer = offers[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <RideMap center={position ?? { lat: 4.0511, lng: 9.7679 }}
               markers={offer ? [{ id: "pickup", kind: "pickup", lat: offer.pickup.lat, lng: offer.pickup.lng },
                                 { id: "dropoff", kind: "dropoff", lat: offer.dropoff.lat, lng: offer.dropoff.lng }] : []} />

      <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0, padding: space.md }}>
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22,
                         backgroundColor: online ? colors.forest : colors.ink }}>
            <Text style={{ color: colors.white, fontWeight: "800", fontSize: 16 }}>{t(online ? "driver.online" : "driver.offline")}</Text>
          </View>
          <Row>
            <Pressable onPress={() => router.push("/earnings")} style={chip}><Text style={chipText}>{t("driver.earnings")}</Text></Pressable>
            <Pressable onPress={() => router.push("/settings")} style={chip} accessibilityLabel={t("common.settings")}><Text style={chipText}>⚙︎</Text></Pressable>
          </Row>
        </Row>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0,
        backgroundColor: colors.ground, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 12 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          {denied ? <Banner kind="warn">{t("driver.locationNeeded")}</Banner> : null}
          {error ? <Banner kind="error">{error}</Banner> : null}

          {online && offer ? (
            <Card style={{ borderColor: colors.amber, borderWidth: 3 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text style={type.title}>{t("driver.newRide")}</Text>
                <Countdown until={offer.expires_at} />
              </Row>
              <Text style={type.label}>{t(`cat.${offer.category}`)} · {t(`pay.${offer.payment_method}`)}</Text>
              {offer.pickup_distance_km != null ? (
                <Text style={type.body}>{t("driver.pickupIn", { km: offer.pickup_distance_km.toFixed(1), min: offer.pickup_eta_min ?? "?" })}</Text>
              ) : null}
              <Muted>→ {offer.dropoff.address ?? `${offer.distance_km} km`} ({offer.distance_km} km, {Math.round(offer.duration_min)} min)</Muted>
              <Muted>{t("driver.youEarn")}</Muted>
              <Text style={type.money}>{xaf(offer.driver_earnings, lang)}</Text>
              <Row>
                <Button style={{ flex: 1 }} variant="secondary" title={t("driver.decline")} onPress={() => decline(offer)} />
                <Button style={{ flex: 2 }} title={t("driver.accept")} onPress={() => accept(offer)} />
              </Row>
            </Card>
          ) : (
            <>
              <Text style={type.title}>{t(online ? "driver.waiting" : "driver.offlineHint")}</Text>
              {me?.driver?.category ? <Muted>{t(`cat.${me.driver.category}`)}</Muted> : null}
            </>
          )}
          <Button variant={online ? "secondary" : "primary"} title={t(online ? "driver.goOffline" : "driver.goOnline")}
                  onPress={toggle} loading={busy} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  return (
    <View style={{ minWidth: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
                   backgroundColor: colors.amberTint, paddingHorizontal: 8 }}>
      <Text style={{ fontWeight: "900", fontSize: 18, color: colors.amberInk }}>{s}</Text>
    </View>
  );
}

const chip = {
  minHeight: 44, paddingHorizontal: 16, justifyContent: "center" as const, borderRadius: 22,
  backgroundColor: colors.surface, elevation: 4, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6,
};
const chipText = { fontWeight: "800" as const, color: colors.ink, fontSize: 16 };
