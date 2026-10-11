"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { API_URL, accessToken, api } from "@/lib/api";
import { dateTime, phone } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Category } from "@/lib/types";
import { CategoryTag } from "@/components/ui";

type LiveDriver = {
  driver_id: string; name: string | null; phone?: string; category: Category | null;
  lat: number; lng: number; heading: number | null; at: string; plate?: string | null;
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const CATEGORY_COLOR: Record<string, string> = {
  moto: "#475467", economy: "#0f6b4a", comfort: "#1d4ed8", prestige: "#7a2e8e", gold: "#c98a0b", platinum: "#283541",
};
const CEMAC_CENTER: [number, number] = [14.5, 3.5]; // roughly centred on the six countries

export default function LivePage() {
  const { t, lang } = useI18n();
  const [drivers, setDrivers] = useState<Record<string, LiveDriver>>({});
  const [connected, setConnected] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers = useRef<Map<string, any>>(new Map());

  // Initial snapshot, then live updates over a WebSocket with automatic reconnect.
  useEffect(() => {
    api<LiveDriver[]>("/admin/live/drivers").then((list) =>
      setDrivers(Object.fromEntries(list.map((d) => [d.driver_id, d]))),
    ).catch(() => {});

    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let ping: ReturnType<typeof setInterval>;

    const connect = () => {
      ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws/admin/live`);
      ws.onopen = () => ws?.send(JSON.stringify({ token: accessToken() }));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === "ready") setConnected(true);
        if (msg.event === "driver.location") {
          setDrivers((prev) => ({ ...prev, [msg.data.driver_id]: { ...prev[msg.data.driver_id], ...msg.data } }));
        }
        if (msg.event === "driver.offline") {
          setDrivers((prev) => {
            const next = { ...prev };
            delete next[msg.data.driver_id];
            return next;
          });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 3000);
      };
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapEl.current || map.current) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !mapEl.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      map.current = new mapboxgl.Map({
        container: mapEl.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: CEMAC_CENTER,
        zoom: 4.2,
      });
      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.current.__mapboxgl = mapboxgl;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync markers with driver state.
  useEffect(() => {
    const m = map.current;
    if (!m?.__mapboxgl) return;
    const seen = new Set<string>();
    for (const d of Object.values(drivers)) {
      if (d.lat == null) continue;
      seen.add(d.driver_id);
      let marker = markers.current.get(d.driver_id);
      if (!marker) {
        const el = document.createElement("div");
        el.style.cssText = `width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px #0003;background:${CATEGORY_COLOR[d.category ?? "economy"]}`;
        el.title = `${d.name ?? ""} (${d.category ?? ""})`;
        marker = new m.__mapboxgl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(m);
        markers.current.set(d.driver_id, marker);
      } else {
        marker.setLngLat([d.lng, d.lat]);
      }
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
  }, [drivers, mapReady]);

  const list = Object.values(drivers).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("nav.live")}</h1>
          <p className="muted">
            <span className={`live-dot ${connected ? "" : "off"}`} aria-hidden="true" />
            {t(connected ? "live.connected" : "live.disconnected")}
          </p>
        </div>
      </div>

      {MAPBOX_TOKEN ? <div ref={mapEl} className="map" /> : <p className="alert alert-warn">{t("live.noToken")}</p>}

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>{t("live.title")}</h2>
          <span className="cell-strong num">{list.length}</span>
        </div>
        {list.length === 0 ? <p className="muted">{t("live.empty")}</p> : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>{t("field.full_name")}</th><th>{t("people.category")}</th><th>{t("field.plate")}</th><th>GPS</th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.driver_id}>
                    <td>
                      <a href={`/drivers/${d.driver_id}`} className="cell-strong">{d.name ?? "—"}</a>
                      {d.phone && <div className="cell-sub num">{phone(d.phone)}</div>}
                    </td>
                    <td><CategoryTag category={d.category} /></td>
                    <td className="num">{d.plate ?? "—"}</td>
                    <td className="num cell-sub">{d.lat?.toFixed(4)}, {d.lng?.toFixed(4)}<br />{dateTime(d.at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
