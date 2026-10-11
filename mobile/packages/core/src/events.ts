import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { accessToken, loadTokens } from "./api";
import { API_URL } from "./config";

export type AkevaEvent = { event: string; data: any };

/**
 * One WebSocket per app (/ws/me) carrying offers, ride updates, driver location and chat.
 * Reconnects with backoff and after the app returns to the foreground. Screens should
 * also poll the REST endpoints occasionally, because mobile networks drop sockets silently.
 */
export function useEvents(onEvent: (e: AkevaEvent) => void, enabled = true): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = async () => {
      await loadTokens();
      if (stopped) return;
      ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws/me`);
      ws.onopen = () => ws?.send(JSON.stringify({ token: accessToken() }));
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(String(m.data)) as AkevaEvent;
          if (msg.event === "ready") {
            attempt = 0;
            setConnected(true);
          } else {
            handler.current(msg);
          }
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        clearInterval(ping);
        if (!stopped) retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    };

    connect();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && ws?.readyState !== WebSocket.OPEN) {
        clearTimeout(retry);
        attempt = 0;
        ws?.close();
        connect();
      }
    });
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      sub.remove();
      ws?.close();
    };
  }, [enabled]);

  return connected;
}

/** Re-run a fetch every few seconds while mounted (fallback for dropped sockets). */
export function usePolling(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}
