import type { RealtimeEvent, SessionUser } from "./types";

const SERVER_KEY = "rms.server";
const TOKEN_KEY = "rms.token";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable; session lasts until reload
  }
}

/** Host running the API/WS services. Defaults to the host serving this page (LAN tablets). */
export function getServerHost(): string {
  const saved = safeGet(SERVER_KEY);
  if (saved) return saved;
  const host = typeof location !== "undefined" ? location.hostname : "";
  return host || "localhost";
}

export function setServerHost(host: string) {
  safeSet(SERVER_KEY, host.trim() || null);
}

export const apiBase = () => `http://${getServerHost()}:3001/api`;
export const wsUrl = () => `ws://${getServerHost()}:3002`;

let token: string | null = safeGet(TOKEN_KEY);

export function getToken() {
  return token;
}

export function setToken(next: string | null) {
  token = next;
  safeSet(TOKEN_KEY, next);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${getServerHost()}. Check that it's running.`, 0);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export async function login(email: string, password: string) {
  const res = await api<{ token: string; user: SessionUser }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  setToken(res.token);
  return res.user;
}

/**
 * Subscribes to real-time events for the signed-in user. Reconnects automatically.
 * Returns an unsubscribe function.
 */
export function subscribeRealtime(
  onEvent: (e: RealtimeEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (!token) return;
    socket = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(token)}`);
    socket.onopen = () => onStatus?.(true);
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data));
        if (data?.type && data.type !== "welcome") onEvent(data as RealtimeEvent);
      } catch {
        // ignore malformed frames
      }
    };
    socket.onclose = () => {
      onStatus?.(false);
      if (!closed) retry = setTimeout(connect, 2000);
    };
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    socket?.close();
  };
}
