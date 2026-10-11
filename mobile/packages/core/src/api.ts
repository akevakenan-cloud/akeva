import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail: Record<string, unknown> | null) {
    super(code);
  }
}

type Tokens = { access: string; refresh: string };
const TOKENS_KEY = "akeva.tokens";
let tokens: Tokens | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

/** Tokens live in the device keychain / keystore, never in plain storage. */
export async function loadTokens(): Promise<Tokens | null> {
  if (tokens) return tokens;
  const raw = await SecureStore.getItemAsync(TOKENS_KEY);
  tokens = raw ? (JSON.parse(raw) as Tokens) : null;
  return tokens;
}

export async function saveTokens(t: Tokens | null) {
  tokens = t;
  if (t) await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(t));
  else await SecureStore.deleteItemAsync(TOKENS_KEY);
}

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

export function accessToken(): string | null {
  return tokens?.access ?? null;
}

async function refresh(): Promise<boolean> {
  const current = await loadTokens();
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
      await saveTokens({ access: data.access_token, refresh: data.refresh_token });
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

const TIMEOUT_MS = 20_000; // mobile networks can be slow; don't hang forever

export async function api<T = unknown>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  await loadTokens();
  const headers: Record<string, string> = { Accept: "application/json", ...(init.headers as Record<string, string>) };
  if (tokens?.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch {
    throw new ApiError(0, "network", null);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && retry && tokens) {
    if (await refresh()) return api<T>(path, init, false);
    await saveTokens(null);
    onSignedOut?.();
  }
  if (!res.ok) {
    let detail: Record<string, unknown> | null = null;
    try {
      detail = (await res.json()).detail ?? null;
    } catch {}
    throw new ApiError(res.status, (detail?.code as string) ?? `http_${res.status}`, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });

/** Upload a photo or PDF taken on the device as an onboarding document. */
export async function uploadDocument(docType: string, file: { uri: string; name: string; type: string }) {
  const form = new FormData();
  form.append("doc_type", docType);
  // React Native's FormData accepts { uri, name, type } objects for files.
  form.append("file", file as unknown as Blob);
  return api<{ id: string; doc_type: string }>("/me/documents", { method: "POST", body: form });
}
