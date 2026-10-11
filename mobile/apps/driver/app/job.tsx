import {
  ApiError, Banner, Button, Card, Muted, RateCard, RideMap, Row, callNumber, colors, get, post, space, type,
  useEvents, useI18n, usePolling, xaf,
  type Ride,
} from "@akeva/core";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDriverTracking } from "../tracking";

/** The accepted ride: go to pickup, wait, drive, finish and collect payment. */
export default function Job() {
  const { t, lang } = useI18n();
  const [ride, setRide] = useState<Ride | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const { position } = useDriverTracking(true);

  const load = useCallback(async () => {
    try {
      const active = await get<Ride | null>("/rides/active");
      if (active) setRide(active);
      else if (!ride || (ride.status !== "completed" && ride.status !== "cancelled")) {
        if (ride) setRide(await get<Ride>(`/rides/${ride.id}`));
        else router.replace("/");
      }
    } catch {}
  }, [ride]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, 10_000, !ride || !["completed", "cancelled"].includes(ride.status));

  useEvents((e) => {
    if (e.event === "ride.updated") setRide(e.data as Ride);
    if (e.event === "ride.message") setUnread((n) => n + 1);
  });

  async function step(action: "arrive" | "start" | "complete") {
    if (!ride) return;
    setBusy(true);
    setError(null);
    try {
      setRide(await post<Ride>(`/rides/${ride.id}/${action}`));
    } catch (e) {
      setError(e instanceof ApiError && e.code === "network" ? t("common.network") : t("common.error"));
      load();
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (!ride) return;
    Alert.alert(t("driver.cancelRide"), t("rider.cancelConfirm"), [
      { text: t("common.no"), style: "cancel" },
      { text: t("common.yes"), style: "destructive", onPress: async () => {
        try {
          setRide(await post<Ride>(`/rides/${ride.id}/cancel`, { reason: "driver_cancelled" }));
        } catch {
          load();
        }
      } },
    ]);
  }

  function navigate(lat: number, lng: number) {
    // Opens Google Maps (Android) or Apple Maps (iOS) with turn-by-turn directions.
    const url = Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    Linking.openURL(url).catch(() => {});
  }

  if (!ride) return <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator size="large" color={colors.forest} /></View>;

  const pickup = { lat: ride.pickup.lat, lng: ride.pickup.lng };
  const dropoff = { lat: ride.dropoff.lat, lng: ride.dropoff.lng };
  const goingTo = ride.status === "in_progress" ? dropoff : pickup;
  const riderName = ride.rider?.name?.split(" ")[0] ?? "";
  const done = ride.status === "completed" || ride.status === "cancelled";

  return (
    <View style={{ flex: 1 }}>
      <RideMap center={position ?? pickup}
               markers={[{ id: "pickup", kind: "pickup", ...pickup }, { id: "dropoff", kind: "dropoff", ...dropoff }]}
               line={position && !done ? [position, goingTo] : undefined} />
      <SafeAreaView edges={["bottom"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "72%",
        backgroundColor: colors.ground, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 12 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          {error ? <Banner kind="error">{error}</Banner> : null}

          {!done ? (
            <>
              <Text style={type.title}>
                {ride.status === "in_progress" ? (ride.dropoff.address ?? t("rider.onTrip")) : t("driver.toPickup", { name: riderName })}
              </Text>
              <Muted>{(ride.status === "in_progress" ? ride.dropoff.address : ride.pickup.address) ?? ""}</Muted>
              <Button variant="secondary" title={t("driver.navigate")} onPress={() => navigate(goingTo.lat, goingTo.lng)} />
              <Row>
                {ride.rider?.phone ? (
                  <Button style={{ flex: 1 }} variant="secondary" title={t("common.call")} onPress={() => callNumber(ride.rider!.phone!)} />
                ) : null}
                <Button style={{ flex: 1 }} variant="secondary" title={unread ? `${t("common.message")} (${unread})` : t("common.message")}
                        onPress={() => { setUnread(0); router.push({ pathname: "/chat", params: { rideId: ride.id } }); }} />
              </Row>
              <Card>
                <Muted>{t("driver.youEarn")} · {t(`pay.${ride.payment.method}`)}</Muted>
                <Text style={type.money}>{xaf(ride.estimate.fare.driver_earnings, lang)}</Text>
              </Card>
              {ride.status === "accepted" ? <Button title={t("driver.arrived")} onPress={() => step("arrive")} loading={busy} /> : null}
              {ride.status === "arrived" ? <Button title={t("driver.start")} onPress={() => step("start")} loading={busy} /> : null}
              {ride.status === "in_progress" ? <Button variant="amber" title={t("driver.complete")} onPress={() => step("complete")} loading={busy} /> : null}
              {ride.status !== "in_progress" ? <Button variant="danger" title={t("driver.cancelRide")} onPress={cancel} /> : null}
            </>
          ) : ride.status === "completed" && ride.fare ? (
            <>
              <Text style={type.title}>
                {ride.payment.method === "cash"
                  ? t("driver.collectCash", { amount: xaf(ride.fare.total, lang) })
                  : t("driver.momoPending", { amount: xaf(ride.fare.total, lang) })}
              </Text>
              <Text style={type.money}>{xaf(ride.fare.total, lang)}</Text>
              <Muted>{t("driver.youEarn")}: {xaf(ride.fare.driver_earnings, lang)}</Muted>
              {!ride.ratings.by_driver ? (
                <RateCard rideId={ride.id} title={t("driver.rateRider")} onDone={() => router.replace("/")} />
              ) : <Button title={t("common.done")} onPress={() => router.replace("/")} />}
            </>
          ) : (
            <>
              <Text style={type.title}>{t("rider.cancelledBy")}</Text>
              <Button title={t("common.done")} onPress={() => router.replace("/")} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
