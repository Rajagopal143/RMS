import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeRealtime, type RealtimeEvent } from "@workspace/shared";

/** Fetches `path` and exposes reload(); pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Calls `onEvent` for every realtime event; returns whether the socket is connected. */
export function useRealtime(onEvent: (e: RealtimeEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => subscribeRealtime((e) => handler.current(e), setConnected), []);
  return connected;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Rupees text field value <-> paise. */
export const toPaise = (rupees: string) => Math.round(Number(rupees || 0) * 100);
export const toRupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, "");
