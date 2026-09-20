import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Flame } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { api, ORDER_TYPE_LABEL, subscribeRealtime, type Order, type OrderItem } from "@workspace/shared";
import { alertUser } from "./alerts";
import { Topbar, useNow } from "./topbar";
import type { Workspace } from "./app";

const LATE_AFTER_MIN = 15;

/**
 * The pass: tickets with this cook's foods hang on a rail, oldest bill first.
 * Cooks see their own categories; managers pass the one category they're viewing.
 * Each food goes Start → In progress → Done; done foods leave the rail.
 */
export function KitchenScreen({
  ws,
  title,
  color,
  categoryId,
  switcher,
}: {
  ws: Workspace;
  title: string;
  color: string;
  categoryId?: number;
  switcher?: ReactNode;
}) {
  const [tickets, setTickets] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const seen = useRef<Set<number> | null>(null);
  const now = useNow();

  const query = categoryId ? `?categoryId=${categoryId}` : "";
  const multiCategory = !categoryId && ws.user.categoryIds.length > 1;
  const categoryColor = (id: number | null) => ws.categories.find((c) => c.id === id)?.color ?? "#9aa0a6";
  const watching = ws.categories
    .filter((c) => (categoryId ? c.id === categoryId : ws.user.categoryIds.includes(c.id)))
    .map((c) => c.name)
    .join(", ");

  const load = useCallback(async () => {
    try {
      const list = await api<Order[]>(`/kitchen/queue${query}`);
      setError(null);
      setTickets(list);
      // Alert on foods we haven't seen, whether a new bill or items added to a table's order.
      const items = list.flatMap((t) => t.items.map((i) => ({ ...i, ticket: t })));
      if (seen.current) {
        const arrived = items.filter((i) => !seen.current!.has(i.id));
        if (arrived.length > 0) {
          const first = arrived[0]!.ticket;
          const where = first.tableNo ? `Table ${first.tableNo}` : ORDER_TYPE_LABEL[first.type];
          alertUser(`New order #${first.orderNo} · ${where}`, arrived.map((i) => `${i.qty} × ${i.name}`).join(", "));
          setFresh(new Set(arrived.map((i) => i.id)));
        }
      }
      seen.current = new Set(items.map((i) => i.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [query]);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeRealtime(() => void load(), setLive);
    // Safety net if the live connection drops without us noticing.
    const safety = setInterval(() => void load(), 15_000);
    return () => {
      unsubscribe();
      clearInterval(safety);
    };
  }, [load]);

  async function advance(item: OrderItem) {
    const next = item.status === "pending" ? "cooking" : "done";
    setBusy((b) => new Set(b).add(item.id));
    try {
      await api(`/kitchen/items/${item.id}`, { method: "PATCH", body: { status: next } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(item.id);
        return n;
      });
    }
    void load();
  }

  const dishes = tickets?.reduce((n, t) => n + t.items.reduce((q, i) => q + i.qty, 0), 0) ?? 0;

  return (
    <div className="min-h-svh bg-[#1d2126]" style={{ ["--ticket-accent" as string]: color }}>
      <Topbar ws={ws} title={title} color={color} live={live} count={tickets ? `${tickets.length} tickets · ${dishes} to cook` : ""} switcher={switcher} />
      {error && <p className="bg-chili px-5 py-2 text-sm text-white">{error}</p>}

      {/* The rail the tickets hang from. */}
      <div className="h-2.5 bg-gradient-to-b from-[#b9bec4] to-[#6b7178] shadow-[0_3px_6px_rgb(0_0_0/0.5)]" />

      {tickets && tickets.length === 0 && (
        <div className="grid place-items-center px-6 py-24 text-center text-white/70">
          <p className="font-display text-4xl font-semibold text-white">Rail's clear</p>
          <p className="mt-2 max-w-sm">Your foods appear here the moment a waiter sends them or a bill is made.</p>
          <p className="mt-6 max-w-sm rounded-md bg-white/5 px-4 py-3 text-sm">
            Signed in as <b className="text-white">{ws.user.email}</b>
            {ws.user.restaurant?.name && ` at ${ws.user.restaurant.name}`}.<br />
            Cooking: <b className="text-white">{watching || "no categories"}</b>.
            {!categoryId && " Only foods in these categories show here. Wrong list? Ask your manager to update your login."}
            {!live && <><br /><span className="text-chili">Not connected. Check the server address and Wi-Fi.</span></>}
          </p>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] items-start gap-x-5 gap-y-8 px-4 pb-10 pt-6 sm:px-5">
        {tickets?.map((t, index) => {
          const minutes = Math.max(0, Math.floor((now - new Date(t.createdAt).getTime()) / 60000));
          const late = minutes >= LATE_AFTER_MIN;
          return (
            <div key={t.id} className="ticket-clip relative">
              <article className="ticket px-4 pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold">{t.tableNo ? `Table ${t.tableNo}` : `#${t.orderNo}`}</span>
                  <span className={cn("rounded px-1.5 text-sm font-semibold", late ? "bg-chili text-white" : "text-muted-foreground")}>{minutes} min</span>
                </div>
                <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
                  <span>
                    {ORDER_TYPE_LABEL[t.type]} · #{t.orderNo}
                  </span>
                  {index === 0 && <span className="rounded bg-ink px-1.5 py-0.5 font-bold text-white">Next up</span>}
                </div>
                <hr className="ticket-rule my-2.5" />
                <ul className="space-y-2 pb-2">
                  {t.items.map((i) => {
                    const cooking = i.status === "cooking";
                    return (
                      <li
                        key={i.id}
                        className={cn("rounded-md border-2 p-2.5", cooking ? "border-turmeric bg-turmeric-soft" : "border-transparent bg-steel/60", fresh.has(i.id) && "ticket-new")}
                      >
                        <div className="flex items-start gap-2.5">
                          {multiCategory && <span className="mt-2 size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(i.categoryId) }} />}
                          <span className="text-xl font-bold leading-6">{i.qty}×</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-semibold leading-6">{i.name}</span>
                            {i.notes && <span className="block text-sm font-semibold text-chili">› {i.notes}</span>}
                            {i.round > 1 && <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Added · round {i.round}</span>}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2 font-sans">
                          {cooking && (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
                              <Flame className="size-4 text-turmeric" /> In progress
                            </span>
                          )}
                          <button
                            onClick={() => advance(i)}
                            disabled={busy.has(i.id)}
                            className={cn(
                              "ml-auto inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50",
                              cooking ? "bg-basil text-white" : "bg-ink text-white",
                            )}
                          >
                            {cooking ? (
                              <>
                                <Check className="size-4" /> Done
                              </>
                            ) : (
                              "Start"
                            )}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {t.notes && <p className="mb-2 text-sm">Note: {t.notes}</p>}
              </article>
            </div>
          );
        })}
      </div>
    </div>
  );
}
