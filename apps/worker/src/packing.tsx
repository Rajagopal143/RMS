import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, MapPin, Phone } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { api, ORDER_TYPE_LABEL, subscribeRealtime, type Order } from "@workspace/shared";
import { alertUser } from "./alerts";
import { Topbar, useNow } from "./topbar";
import type { Workspace } from "./app";

/** Orders arrive here when every cook has finished. Check items into the bag, then hand over. */
export function PackingScreen({ ws, switcher }: { ws: Workspace; switcher?: ReactNode }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [packed, setPacked] = useState<Record<number, Set<number>>>({});
  const readyIds = useRef<Set<number> | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const list = await api<Order[]>("/packing/queue");
      setError(null);
      setOrders(list);
      const ready = list.filter((o) => o.status === "packing");
      if (readyIds.current) {
        const arrived = ready.filter((o) => !readyIds.current!.has(o.id));
        if (arrived.length > 0) {
          alertUser(`Order #${arrived[0]!.orderNo} ready to pack`, arrived[0]!.items.map((i) => `${i.qty} × ${i.name}`).join(", "));
        }
      }
      readyIds.current = new Set(ready.map((o) => o.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeRealtime(() => void load(), setLive);
    const safety = setInterval(() => void load(), 60_000);
    return () => {
      unsubscribe();
      clearInterval(safety);
    };
  }, [load]);

  function toggle(orderId: number, itemId: number) {
    setPacked((p) => {
      const set = new Set(p[orderId]);
      if (set.has(itemId)) set.delete(itemId);
      else set.add(itemId);
      return { ...p, [orderId]: set };
    });
  }

  async function handOver(order: Order) {
    setOrders((os) => os?.filter((o) => o.id !== order.id) ?? null);
    try {
      await api(`/packing/orders/${order.id}/complete`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    }
    void load();
  }

  const categoryOf = (id: number | null) => ws.categories.find((c) => c.id === id);
  const ready = orders?.filter((o) => o.status === "packing") ?? [];
  const inKitchen = orders?.filter((o) => o.status !== "packing") ?? [];

  return (
    <div className="min-h-svh bg-[#1d2126]">
      <Topbar ws={ws} title="Packing" color="#ffffff" live={live} count={orders ? `${ready.length} ready · ${inKitchen.length} cooking` : ""} switcher={switcher} />
      {error && <p className="bg-chili px-5 py-2 text-sm text-white">{error}</p>}

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-white/60">Ready to pack</h2>
          {orders && ready.length === 0 && (
            <p className="rounded-lg border border-dashed border-white/20 px-6 py-16 text-center text-white/60">
              Nothing to pack. Orders land here as soon as every cook marks them done.
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-5">
            {ready.map((o) => {
              const checked = packed[o.id] ?? new Set<number>();
              const allChecked = o.items.every((i) => checked.has(i.id));
              const waited = Math.max(0, Math.floor((now - new Date(o.createdAt).getTime()) / 60000));
              return (
                <article key={o.id} className="ticket ticket-new px-4 pt-3" style={{ ["--ticket-accent" as string]: o.type === "delivery" ? "var(--color-chili)" : "var(--color-basil)" }}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-bold">#{o.orderNo}</span>
                    <span className="text-sm text-muted-foreground">{waited} min</span>
                  </div>
                  <p className="text-sm font-semibold uppercase tracking-wider">
                    {ORDER_TYPE_LABEL[o.type]}
                    {o.tableNo && ` · Table ${o.tableNo}`}
                  </p>
                  {o.customerName && <p className="text-sm">{o.customerName}</p>}
                  {o.type === "delivery" && o.customerAddress && (
                    <p className="mt-1 flex gap-1.5 text-sm">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" /> {o.customerAddress}
                    </p>
                  )}
                  {o.customerPhone && (
                    <p className="flex items-center gap-1.5 text-sm">
                      <Phone className="size-3.5" /> {o.customerPhone}
                    </p>
                  )}
                  <hr className="ticket-rule my-2.5" />
                  <ul className="space-y-1">
                    {o.items.map((i) => {
                      const on = checked.has(i.id);
                      const category = categoryOf(i.categoryId);
                      return (
                        <li key={i.id}>
                          <button onClick={() => toggle(o.id, i.id)} className="flex w-full items-center gap-2.5 rounded px-1 py-1.5 text-left active:bg-steel">
                            <span className={cn("grid size-6 shrink-0 place-items-center rounded border-2", on ? "border-basil bg-basil text-white" : "border-ink/40")}>
                              {on && <Check className="size-4" />}
                            </span>
                            <span className={cn("flex-1 text-base", on && "text-muted-foreground line-through")}>
                              {i.qty} × {i.name}
                            </span>
                            {category && <span className="size-2 rounded-full" style={{ background: category.color }} title={category.name} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    onClick={() => handOver(o)}
                    disabled={!allChecked}
                    className="mb-2 mt-3 w-full rounded-md bg-ink py-3 font-sans text-base font-semibold text-white disabled:bg-steel disabled:text-muted-foreground"
                  >
                    {allChecked ? "Packed & handed over" : `Check ${o.items.length - checked.size} more`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <aside>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-white/60">Still in the kitchen</h2>
          <div className="space-y-2">
            {inKitchen.length === 0 && <p className="text-sm text-white/50">Nothing cooking right now.</p>}
            {inKitchen.map((o) => {
              const done = o.items.filter((i) => i.status === "done").length;
              return (
                <div key={o.id} className="rounded-lg bg-white/5 px-3 py-2.5 text-white">
                  <div className="flex items-baseline justify-between">
                    <span className="tabular font-bold">#{o.orderNo}</span>
                    <span className="text-xs text-white/60">
                      {ORDER_TYPE_LABEL[o.type]} · {done}/{o.items.length} done
                    </span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {o.items.map((i) => (
                      <span
                        key={i.id}
                        title={`${i.name}: ${i.status}`}
                        className={cn("h-1.5 flex-1 rounded-full", i.status === "pending" && "opacity-25")}
                        style={{ background: i.status === "done" ? "var(--color-basil)" : (categoryOf(i.categoryId)?.color ?? "#9aa0a6") }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
