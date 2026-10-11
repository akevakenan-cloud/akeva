"use client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(code);
  }
}

type Tokens = { access: string; refresh: string };
const KEY = "akeva.session";
let tokens: Tokens | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

// Session storage: tokens disappear when the tab closes, which suits a shared office PC.
export function loadSession(): Tokens | null {
  if (tokens) return tokens;
  try {
    const raw = sessionStorage.getItem(KEY);
    tokens = raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    tokens = null;
  }
  return tokens;
}

export function saveSession(t: Tokens | null) {
  tokens = t;
  try {
    if (t) sessionStorage.setItem(KEY, JSON.stringify(t));
    else sessionStorage.removeItem(KEY);
  } catch {}
}

export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

export function accessToken(): string | null {
  return loadSession()?.access ?? null;
}

async function refresh(): Promise<boolean> {
  const current = loadSession();
  if (!current) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh }),
      });
      if (!r.ok) return false;
      const data = await r.json();
      saveSession({ access: data.access_token, refresh: data.refresh_token });
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function apiRaw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = accessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", null);
  }
  if (res.status === 401 && retry && token) {
    if (await refresh()) return apiRaw(path, init, false);
    saveSession(null);
    onSessionLost?.();
  }
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {}
    const code = (detail as { code?: string } | null)?.code ?? `http_${res.status}`;
    throw new ApiError(res.status, code, detail);
  }
  return res;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiRaw(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export function qs(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

/** Download an authenticated file (CSV export) through a temporary object URL. */
export async function download(path: string, fallbackName: string) {
  const res = await apiRaw(path);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
