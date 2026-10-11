import Mapbox from "@rnmapbox/maps";
import { Text, View } from "react-native";
import { MAPBOX_TOKEN } from "./config";
import { colors, radius } from "./theme";

if (MAPBOX_TOKEN) Mapbox.setAccessToken(MAPBOX_TOKEN);

export type LatLng = { lat: number; lng: number };
export type MapMarker = LatLng & { id: string; kind: "pickup" | "dropoff" | "driver" | "car" };

const MARKER_COLOR: Record<MapMarker["kind"], string> = {
  pickup: colors.forest,
  dropoff: colors.ink,
  driver: colors.amber,
  car: colors.amber,
};

/**
 * Map used by both apps. Mapbox caches tiles it has shown, which helps on weak
 * networks; offline packs for whole cities can be added with Mapbox's offline API.
 */
export function RideMap({ center, markers = [], line, showUser = true, onLongPress, style }: {
  center: LatLng; markers?: MapMarker[]; line?: LatLng[]; showUser?: boolean;
  onLongPress?: (p: LatLng) => void; style?: object;
}) {
  if (!MAPBOX_TOKEN) {
    return (
      <View style={[{ flex: 1, backgroundColor: "#dde5e0", alignItems: "center", justifyContent: "center", padding: 24 }, style]}>
        <Text style={{ color: colors.ink2, textAlign: "center" }}>Set EXPO_PUBLIC_MAPBOX_TOKEN to show the map.</Text>
      </View>
    );
  }
  const bounds = markers.length >= 2 ? boundsOf(markers) : null;
  return (
    <Mapbox.MapView
      style={[{ flex: 1 }, style]}
      styleURL={Mapbox.StyleURL.Street}
      logoEnabled={false}
      scaleBarEnabled={false}
      onLongPress={(f: any) => {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        onLongPress?.({ lat, lng });
      }}
    >
      {bounds ? (
        <Mapbox.Camera bounds={{ ne: bounds.ne, sw: bounds.sw, paddingTop: 80, paddingBottom: 320, paddingLeft: 48, paddingRight: 48 }}
                       animationDuration={600} />
      ) : (
        <Mapbox.Camera centerCoordinate={[center.lng, center.lat]} zoomLevel={14} animationDuration={600} />
      )}
      {showUser ? <Mapbox.UserLocation visible /> : null}
      {line && line.length >= 2 ? (
        <Mapbox.ShapeSource id="route" shape={{
          type: "Feature", properties: {},
          geometry: { type: "LineString", coordinates: line.map((p) => [p.lng, p.lat]) },
        }}>
          <Mapbox.LineLayer id="routeLine" style={{ lineColor: colors.forest, lineWidth: 5, lineDasharray: [1.5, 1] }} />
        </Mapbox.ShapeSource>
      ) : null}
      {markers.map((m) => (
        <Mapbox.MarkerView key={m.id} coordinate={[m.lng, m.lat]}>
          <View style={{
            width: m.kind === "car" || m.kind === "driver" ? 30 : 24, height: m.kind === "car" || m.kind === "driver" ? 30 : 24,
            borderRadius: m.kind === "dropoff" ? 4 : radius.pill, backgroundColor: MARKER_COLOR[m.kind],
            borderWidth: 4, borderColor: colors.white,
          }} />
        </Mapbox.MarkerView>
      ))}
    </Mapbox.MapView>
  );
}

function boundsOf(points: LatLng[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return { ne: [Math.max(...lngs), Math.max(...lats)], sw: [Math.min(...lngs), Math.min(...lats)] };
}

export type SearchResult = LatLng & { name: string; address: string };

/** Forward geocoding with Mapbox, biased towards the user's position and country. */
export async function searchPlaces(query: string, country: string, near: LatLng | null, lang: string): Promise<SearchResult[]> {
  if (!MAPBOX_TOKEN || query.trim().length < 3) return [];
  const params = new URLSearchParams({
    q: query, country: country.toLowerCase(), language: lang, limit: "6", access_token: MAPBOX_TOKEN,
  });
  if (near) params.set("proximity", `${near.lng},${near.lat}`);
  try {
    const r = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.features ?? []).map((f: any) => ({
      name: f.properties?.name ?? f.properties?.full_address ?? query,
      address: f.properties?.full_address ?? f.properties?.place_formatted ?? "",
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
  } catch {
    return [];
  }
}
