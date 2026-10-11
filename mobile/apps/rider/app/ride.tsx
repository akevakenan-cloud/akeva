import {
  ApiError, Banner, Button, Card, Muted, RateCard, RideMap, Row, callNumber, colors, get, post, space, type,
  useEvents, useI18n, usePolling, xaf,
  type LatLng, type Ride,
} from "@akeva/core";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** The ride in progress: searching, driver on the way, arrived, on trip, finished. */
export default function RideScreen() {
  const { t, lang } = useI18n();
  const [ride, setRide] = useState<Ride | null>(null);
  const [finished, setFinished] = useState<Ride | null>(null); // kept after it leaves /rides/active
  const [driverPos, setDriverPos] = useState<LatLng | null>(null);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const active = await get<Ride | null>("/rides/active");
      if (active) {
        setRide(active);
        if (active.driver_location) setDriverPos(active.driver_location);
        const full = await get<Ride>(`/rides/${active.id}`);
        if (full.driver_location) setDriverPos(full.driver_location);
      } else if (ride) {
        // Ride ended while we weren't listening: fetch its final state once.
        setFinished(await get<Ride>(`/rides/${ride.id}`));
        setRide(null);
      } else if (!finished) {
        router.replace("/");
      }
    } catch {}
  }, [ride, finished]);

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, 8000, !finished);

  useEvents((e) => {
    if (e.event === "ride.updated") {
      const r = e.data as Ride;
      if (r.status === "completed" || r.status === "cancelled") {
        setFinished(r);
        setRide(null);
      } else {
        setRide(r);
      }
    } else if (e.event === "driver.location") {
      setDriverPos({ lat: e.data.lat, lng: e.data.lng });
    } else if (e.event === "ride.message") {
      setUnread((n) => n + 1);
    }
  });

  function cancel() {
    if (!ride) return;
    Alert.alert(t("rider.cancelRide"), t("rider.cancelConfirm"), [
      { text: t("common.no"), style: "cancel" },
      { text: t("common.yes"), style: "destructive", onPress: async () => {
        setBusy(true);
        try {
          setFinished(await post<Ride>(`/rides/${ride.id}/cancel`, { reason: "rider_cancelled" }));
          setRide(null);
        } catch (err) {
          if (err instanceof ApiError) load();
        } finally {
          setBusy(false);
        }
      } },
    ]);
  }

  const current = ride ?? finished;
  if (!current) return <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator size="large" color={colors.forest} /></View>;

  const pickup = { lat: current.pickup.lat, lng: current.pickup.lng };
  const dropoff = { lat: current.dropoff.lat, lng: current.dropoff.lng };
  const target = current.status === "in_progress" ? dropoff : pickup;
  const markers = [
    { id: "pickup", kind: "pickup" as const, ...pickup },
    { id: "dropoff", kind: "dropoff" as const, ...dropoff },
    ...(driverPos && current.status !== "completed" ? [{ id: "driver", kind: "driver" as const, ...driverPos }] : []),
  ];

  return (
    <View style={{ flex: 1 }}>
      <RideMap center={driverPos ?? pickup} markers={markers} line={driverPos ? [driverPos, target] : [pickup, dropoff]} />
      <SafeAreaView edges={["bottom"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "70%",
        backgroundColor: colors.ground, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 12 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          {current.status === "requested" ? (
            <>
              <Row><ActivityIndicator color={colors.forest} /><Text style={type.title}>{t("rider.searching")}</Text></Row>
              <Muted>{t("rider.searchingHint")}</Muted>
              <Text style={type.money}>{xaf(current.estimate.fare.total, lang)}</Text>
              <Button variant="danger" title={t("rider.cancelRide")} onPress={cancel} loading={busy} />
            </>
          ) : null}

          {(current.status === "accepted" || current.status === "arrived" || current.status === "in_progress") && current.driver ? (
            <>
              <Text style={type.title}>{t(current.status === "accepted" ? "rider.driverComing"
                : current.status === "arrived" ? "rider.driverArrived" : "rider.onTrip")}</Text>
              <Card>
                <Text style={type.heading}>{current.driver.name} {current.driver.rating ? `★ ${current.driver.rating.toFixed(1)}` : ""}</Text>
                <Text style={[type.body, { fontWeight: "800", fontSize: 22, letterSpacing: 1 }]}>{current.driver.vehicle.plate_number}</Text>
                <Muted>{`${current.driver.vehicle.color} ${current.driver.vehicle.make} ${current.driver.vehicle.model}`.trim()}</Muted>
              </Card>
              <Row>
                {current.driver.phone ? (
                  <Button style={{ flex: 1 }} variant="secondary" title={t("common.call")} onPress={() => callNumber(current.driver!.phone!)} />
                ) : null}
                <Button style={{ flex: 1 }} variant="secondary"
                        title={unread ? `${t("common.message")} (${unread})` : t("common.message")}
                        onPress={() => { setUnread(0); router.push({ pathname: "/chat", params: { rideId: current.id } }); }} />
              </Row>
              <Muted>{xaf(current.estimate.fare.total, lang)} · {t(`pay.${current.payment.method}`)}</Muted>
              {current.status !== "in_progress" ? (
                <Button variant="danger" title={t("rider.cancelRide")} onPress={cancel} loading={busy} />
              ) : null}
            </>
          ) : null}

          {current.status === "completed" && current.fare ? (
            <>
              <Text style={type.title}>{t("rider.tripDone")}</Text>
              <Muted>{t("rider.total")}</Muted>
              <Text style={type.money}>{xaf(current.fare.total, lang)}</Text>
              <Banner>{current.payment.method === "cash"
                ? t("rider.payCash", { amount: xaf(current.fare.total, lang) })
                : t("rider.payMomo", { amount: xaf(current.fare.total, lang), method: t(`pay.${current.payment.method}`) })}</Banner>
              {!current.ratings.by_rider ? (
                <RateCard rideId={current.id} title={t("rider.rateDriver")} onDone={() => router.replace("/")} />
              ) : <Button title={t("common.done")} onPress={() => router.replace("/")} />}
            </>
          ) : null}

          {current.status === "cancelled" ? (
            <>
              <Text style={type.title}>{t("rider.cancelledBy")}</Text>
              {current.cancel_reason === "no_driver_available" ? <Banner kind="warn">{t("rider.noDriver")}</Banner> : null}
              <Button title={t("common.done")} onPress={() => router.replace("/")} />
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
