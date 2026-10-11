import { post, type LatLng } from "@akeva/core";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";

/**
 * Sends the driver's GPS position while online: every ~5 s or 25 m, whichever
 * comes first. This runs while the app is open (foreground). For production,
 * add background tracking with expo-task-manager so it continues while the
 * driver uses Waze or Google Maps.
 */
export function useDriverTracking(enabled: boolean) {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [denied, setDenied] = useState(false);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return setDenied(true);
      setDenied(false);
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 25 },
        (loc) => {
          if (cancelled) return;
          const p = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setPosition(p);
          const now = Date.now();
          if (now - lastSent.current < 4000) return; // don't flood the server on fast updates
          lastSent.current = now;
          const heading = loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null;
          const speed = loc.coords.speed != null && loc.coords.speed >= 0 ? Math.min(300, loc.coords.speed * 3.6) : null;
          post("/drivers/me/location", { ...p, heading, speed_kmh: speed }).catch(() => {});
        },
      );
    })().catch(() => setDenied(true));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return { position, denied };
}
