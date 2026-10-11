import {
  ApiError, Banner, Button, Choice, MOBILE_MONEY, Muted, RideMap, Row, colors, get, post, radius, searchPlaces, space,
  type, useI18n, useSession, xaf,
  type CountryCode, type Estimate, type LatLng, type Ride, type SearchResult,
} from "@akeva/core";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Dest = { lat: number; lng: number; address: string };

/** Home: pick a destination, compare categories, request a ride. */
export default function Home() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const [here, setHere] = useState<LatLng | null>(null);
  const [locError, setLocError] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [dest, setDest] = useState<Dest | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [payment, setPayment] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume an ongoing ride (e.g. after the app was closed).
  useEffect(() => {
    get<Ride | null>("/rides/active").then((r) => r && router.replace("/ride")).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return setLocError(true);
      const last = await Location.getLastKnownPositionAsync();
      if (last) setHere({ lat: last.coords.latitude, lng: last.coords.longitude });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })().catch(() => setLocError(true));
  }, []);

  useEffect(() => {
    if (!me || query.trim().length < 3) return setResults([]);
    const id = setTimeout(() => searchPlaces(query, me.country, here, lang).then(setResults), 350);
    return () => clearTimeout(id);
  }, [query, me, here, lang]);

  const loadEstimate = useCallback(async (d: Dest) => {
    if (!here) return;
    setEstimate(null);
    setError(null);
    try {
      const e = await post<Estimate>("/rides/estimate", {
        pickup: { lat: here.lat, lng: here.lng }, dropoff: { lat: d.lat, lng: d.lng },
      });
      setEstimate(e);
      setCategory(e.options.find((o) => o.available)?.category ?? null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "network" ? t("common.network") : t("common.error"));
    }
  }, [here, t]);

  function choose(d: Dest) {
    setDest(d);
    setResults([]);
    setQuery(d.address);
    loadEstimate(d);
  }

  async function request() {
    if (!here || !dest || !category) return;
    setBusy(true);
    setError(null);
    try {
      await post<Ride>("/rides", {
        pickup: { lat: here.lat, lng: here.lng, address: t("rider.myLocation") },
        dropoff: { lat: dest.lat, lng: dest.lng, address: dest.address },
        category, payment_method: payment,
      });
      router.replace("/ride");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "ride_already_active") return router.replace("/ride");
      setError(code === "not_approved" ? t("rider.notApproved") : code === "network" ? t("common.network") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const methods = ["cash", ...(MOBILE_MONEY[(me?.country ?? "CM") as CountryCode] ?? [])];
  const markers = [
    ...(here ? [{ id: "pickup", kind: "pickup" as const, ...here }] : []),
    ...(dest ? [{ id: "dropoff", kind: "dropoff" as const, lat: dest.lat, lng: dest.lng }] : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <RideMap center={here ?? { lat: 4.0511, lng: 9.7679 }} markers={markers}
               line={here && dest ? [here, dest] : undefined}
               onLongPress={(p) => choose({ ...p, address: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` })} />

      <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0, padding: space.md }}>
        <Row style={{ justifyContent: "flex-end", gap: space.sm }}>
          <Pressable onPress={() => router.push("/history")} style={chip}><Text style={chipText}>{t("rider.history")}</Text></Pressable>
          <Pressable onPress={() => router.push("/settings")} style={chip} accessibilityLabel={t("common.settings")}>
            <Text style={chipText}>⚙︎</Text>
          </Pressable>
        </Row>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={sheet}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md, padding: space.lg }}>
          {locError ? <Banner kind="warn">{t("rider.locationNeeded")}</Banner> : null}
          <Text style={type.title}>{t("rider.whereTo")}</Text>
          <TextInput value={query} onChangeText={(v) => { setQuery(v); setDest(null); setEstimate(null); }}
                     placeholder={t("rider.searchPlace")} placeholderTextColor={colors.ink3} accessibilityLabel={t("rider.searchPlace")}
                     style={{ minHeight: 56, borderWidth: 2, borderColor: colors.lineStrong, borderRadius: radius.md,
                              paddingHorizontal: space.md, fontSize: 18, backgroundColor: colors.surface }} />
          {results.map((r) => (
            <Pressable key={`${r.lat},${r.lng}`} onPress={() => choose({ lat: r.lat, lng: r.lng, address: r.name })}
                       style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line }}>
              <Text style={[type.body, { fontWeight: "700" }]}>{r.name}</Text>
              <Muted>{r.address}</Muted>
            </Pressable>
          ))}
          {!dest && results.length === 0 ? <Muted>{t("rider.pinHint")}</Muted> : null}

          {dest && !estimate && !error ? <ActivityIndicator color={colors.forest} /> : null}
          {estimate ? (
            <>
              <Text style={type.heading}>{t("rider.chooseRide")}</Text>
              {estimate.options.map((o) => {
                const on = category === o.category;
                return (
                  <Pressable key={o.category} disabled={!o.available} onPress={() => setCategory(o.category)}
                             accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !o.available }}
                             style={{ flexDirection: "row", alignItems: "center", padding: space.md, minHeight: 64,
                                      borderRadius: radius.md, borderWidth: 2, opacity: o.available ? 1 : 0.5,
                                      borderColor: on ? colors.forest : colors.line,
                                      backgroundColor: on ? colors.forestTint : colors.surface }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, { fontWeight: "800" }]}>{t(`cat.${o.category}`)}</Text>
                      <Muted>{o.available ? t("rider.minAway", { n: o.pickup_eta_min ?? "?" }) : t("rider.unavailable")}</Muted>
                    </View>
                    <Text style={[type.heading, { fontVariant: ["tabular-nums"] }]}>{xaf(o.fare, lang)}</Text>
                  </Pressable>
                );
              })}
              <Choice label={t("rider.payWith")} value={payment} onChange={setPayment}
                      options={methods.map((m) => ({ value: m, label: t(`pay.${m}`) }))} />
            </>
          ) : null}
          {error ? <Banner kind="error">{error}</Banner> : null}
          {estimate && category ? (
            <Button title={t("rider.request", { cat: t(`cat.${category}`) })} onPress={request} loading={busy} />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const sheet = {
  position: "absolute" as const, left: 0, right: 0, bottom: 0, maxHeight: "62%" as const,
  backgroundColor: colors.ground, borderTopLeftRadius: 24, borderTopRightRadius: 24,
  shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, elevation: 12,
};
const chip = {
  minHeight: 44, paddingHorizontal: 16, justifyContent: "center" as const, borderRadius: 22,
  backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, elevation: 4,
};
const chipText = { fontWeight: "800" as const, color: colors.ink, fontSize: 16 };
