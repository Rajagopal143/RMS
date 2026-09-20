import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BellRing, Check, ChefHat, Flame, Minus, Plus, Search, StickyNote, Utensils } from "lucide-react";
import { toast } from "@workspace/ui/components/sonner";
import { cn } from "@workspace/ui/lib/utils";
import { api, formatMoney, subscribeRealtime, type MenuItem, type Order, type OrderItem, type TableStatus } from "@workspace/shared";
import { alertUser } from "./alerts";
import { Topbar, useNow } from "./topbar";
import type { Workspace } from "./app";

type View = { kind: "tables" } | { kind: "table"; tableId: number } | { kind: "add"; tableId: number };

/** What a table needs from the waiter right now. */
function tableState(order: Order | null) {
  if (!order) return { label: "Free", tone: "free" as const };
  const ready = order.items.filter((i) => i.status === "done");
  if (ready.length) return { label: `${ready.reduce((n, i) => n + i.qty, 0)} ready to serve`, tone: "ready" as const };
  if (order.items.some((i) => i.status === "pending" || i.status === "cooking")) return { label: "In kitchen", tone: "kitchen" as const };
  return { label: "Served · awaiting bill", tone: "served" as const };
}

const TONE: Record<ReturnType<typeof tableState>["tone"], string> = {
  free: "bg-card text-muted-foreground",
  kitchen: "bg-turmeric-soft text-ink",
  ready: "bg-basil text-white",
  served: "bg-steel text-ink",
};

export function WaiterScreen({ ws, menu }: { ws: Workspace; menu: MenuItem[] }) {
  const [tables, setTables] = useState<TableStatus[] | null>(null);
  const [view, setView] = useState<View>({ kind: "tables" });
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readySeen = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<TableStatus[]>("/tables/status");
      setError(null);
      setTables(list);
      // Tell the waiter the moment food is ready at any table.
      const ready = list.flatMap((t) => (t.order?.items ?? []).filter((i) => i.status === "done").map((i) => ({ ...i, table: t.name })));
      if (readySeen.current) {
        const fresh = ready.filter((i) => !readySeen.current!.has(i.id));
        const byTable = new Map<string, typeof fresh>();
        for (const i of fresh) byTable.set(i.table, [...(byTable.get(i.table) ?? []), i]);
        for (const [table, items] of byTable) {
          alertUser(`Table ${table}: food ready`, items.map((i) => `${i.qty} × ${i.name}`).join(", "));
        }
      }
      readySeen.current = new Set(ready.map((i) => i.id));
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

  const readyCount = tables?.filter((t) => tableState(t.order).tone === "ready").length ?? 0;
  const table = view.kind !== "tables" ? tables?.find((t) => t.id === view.tableId) : undefined;

  return (
    <div className="min-h-svh bg-background">
      <Topbar ws={ws} title="Tables" color="var(--color-turmeric)" live={live} count={readyCount ? `${readyCount} with food ready` : ""} />
      {error && <p className="bg-chili px-4 py-2 text-sm text-white">{error}</p>}

      {view.kind === "tables" && (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {tables?.length === 0 && (
            <p className="col-span-full py-16 text-center text-muted-foreground">No tables yet. Ask your manager to add them in the admin app.</p>
          )}
          {tables?.map((t) => {
            const state = tableState(t.order);
            return (
              <button
                key={t.id}
                onClick={() => setView({ kind: "table", tableId: t.id })}
                className={cn(
                  "flex min-h-28 flex-col justify-between rounded-xl border p-3 text-left shadow-sm transition active:scale-[0.98]",
                  state.tone === "free" ? "bg-card" : "border-ink/20 bg-card",
                  state.tone === "ready" && "ring-2 ring-basil",
                )}
              >
                <span className="flex items-baseline justify-between">
                  <span className="font-display text-3xl font-semibold">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.seats} seats</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TONE[state.tone])}>{state.label}</span>
                  {t.order && <span className="tabular text-sm font-semibold">{formatMoney(t.order.total)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {view.kind === "table" && table && (
        <TableDetail table={table} onBack={() => setView({ kind: "tables" })} onAdd={() => setView({ kind: "add", tableId: table.id })} onChanged={load} />
      )}

      {view.kind === "add" && table && (
        <AddItems
          ws={ws}
          table={table}
          menu={menu}
          onBack={() => setView({ kind: "table", tableId: table.id })}
          onSent={async () => {
            await load();
            setView({ kind: "table", tableId: table.id });
          }}
        />
      )}
    </div>
  );
}

function TableDetail({ table, onBack, onAdd, onChanged }: { table: TableStatus; onBack: () => void; onAdd: () => void; onChanged: () => Promise<void> }) {
  const order = table.order;
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const ready = order?.items.filter((i) => i.status === "done") ?? [];
  const kitchen = order?.items.filter((i) => i.status === "pending" || i.status === "cooking") ?? [];
  const served = order?.items.filter((i) => i.status === "served") ?? [];

  async function serve(itemIds?: number[]) {
    if (!order) return;
    setBusy(true);
    try {
      await api(`/orders/${order.id}/serve`, { method: "POST", body: itemIds ? { itemIds } : {} });
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl pb-28">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <button onClick={onBack} className="-ml-1 rounded-md p-1.5 hover:bg-muted" aria-label="Back to tables">
          <ArrowLeft className="size-5" />
        </button>
        <div className="flex-1">
          <h2 className="font-display text-2xl font-semibold leading-tight">Table {table.name}</h2>
          <p className="text-xs text-muted-foreground">
            {order ? `Order #${order.orderNo} · open ${Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 60000))} min` : `${table.seats} seats · free`}
          </p>
        </div>
        {order && <span className="tabular text-lg font-semibold">{formatMoney(order.total)}</span>}
      </div>

      {!order && (
        <div className="px-6 py-16 text-center text-muted-foreground">
          <Utensils className="mx-auto mb-3 size-8" />
          Nobody's ordered here yet. Tap <b>Add items</b> to start the table's order.
        </div>
      )}

      {ready.length > 0 && (
        <Section
          title="Ready to serve"
          icon={<BellRing className="size-4 text-basil" />}
          action={
            <button disabled={busy} onClick={() => serve()} className="rounded-md bg-basil px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              Serve all
            </button>
          }
        >
          {ready.map((i) => (
            <ItemRow key={i.id} item={i}>
              <button disabled={busy} onClick={() => serve([i.id])} className="rounded-md border border-basil px-3 py-1 text-sm font-semibold text-basil disabled:opacity-50">
                Serve
              </button>
            </ItemRow>
          ))}
        </Section>
      )}

      {kitchen.length > 0 && (
        <Section title="In the kitchen" icon={<ChefHat className="size-4" />}>
          {kitchen.map((i) => (
            <ItemRow key={i.id} item={i}>
              {i.status === "cooking" ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
                  <Flame className="size-3.5 text-turmeric" /> Cooking
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Waiting</span>
              )}
            </ItemRow>
          ))}
        </Section>
      )}

      {served.length > 0 && (
        <Section title="Served" icon={<Check className="size-4" />}>
          {served.map((i) => (
            <ItemRow key={i.id} item={i} muted />
          ))}
        </Section>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t bg-card/95 p-3 backdrop-blur">
        <button onClick={onAdd} className="mx-auto flex h-12 w-full max-w-xl items-center justify-center gap-2 rounded-lg bg-ink text-base font-semibold text-white">
          <Plus className="size-5" /> Add items
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-4 px-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold uppercase tracking-wider">{title}</h3>
        <span className="ml-auto">{action}</span>
      </div>
      <ul className="divide-y rounded-lg border bg-card">{children}</ul>
    </section>
  );
}

function ItemRow({ item, muted, children }: { item: OrderItem; muted?: boolean; children?: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5", muted && "text-muted-foreground")}>
      <span className="tabular w-7 font-semibold">{item.qty}×</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.name}</span>
        {item.notes && <span className="block truncate text-xs text-muted-foreground">› {item.notes}</span>}
      </span>
      {children}
    </li>
  );
}

interface CartLine {
  menuItemId: number;
  qty: number;
  notes: string;
}

function AddItems({
  ws,
  table,
  menu,
  onBack,
  onSent,
}: {
  ws: Workspace;
  table: TableStatus;
  menu: MenuItem[];
  onBack: () => void;
  onSent: () => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(menu.map((m) => [m.id, m])), [menu]);
  const visible = menu.filter(
    (m) => m.isAvailable && (categoryId === "all" || m.categoryId === categoryId) && (!query || m.name.toLowerCase().includes(query.toLowerCase())),
  );
  const qtyOf = (id: number) => cart.find((l) => l.menuItemId === id)?.qty ?? 0;
  const count = cart.reduce((n, l) => n + l.qty, 0);
  const amount = cart.reduce((s, l) => s + (byId.get(l.menuItemId)?.price ?? 0) * l.qty, 0);

  function change(id: number, delta: number) {
    setCart((c) => {
      const line = c.find((l) => l.menuItemId === id);
      if (!line) return delta > 0 ? [...c, { menuItemId: id, qty: 1, notes: "" }] : c;
      return c.map((l) => (l === line ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0);
    });
  }

  async function send() {
    setBusy(true);
    try {
      const res = await api<{ noCookCategories: string[] }>("/orders", {
        method: "POST",
        body: {
          type: "dine_in",
          tableId: table.id,
          items: cart.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, notes: l.notes || null })),
        },
      });
      toast.success(`Sent ${count} ${count === 1 ? "item" : "items"} to the kitchen for table ${table.name}`);
      if (res.noCookCategories.length) {
        toast.warning(`No cook is assigned to ${res.noCookCategories.join(", ")}`, {
          description: "Tell your manager: those foods won't reach any cook.",
          duration: 12000,
        });
      }
      await onSent();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl pb-28">
      <div className="sticky top-[57px] z-[5] border-b bg-card px-4 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="-ml-1 rounded-md p-1.5 hover:bg-muted" aria-label="Back to table">
            <ArrowLeft className="size-5" />
          </button>
          <h2 className="flex-1 font-display text-xl font-semibold">Add to table {table.name}</h2>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:border-ink"
            placeholder="Search foods"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4">
          {[{ id: "all" as const, name: "All", color: "" }, ...ws.categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm", categoryId === c.id ? "border-ink bg-ink text-white" : "bg-card")}
            >
              {c.color && <span className="size-2 rounded-full" style={{ background: c.color }} />}
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y">
        {visible.map((m) => {
          const qty = qtyOf(m.id);
          const line = cart.find((l) => l.menuItemId === m.id);
          return (
            <li key={m.id} className="bg-card px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={cn("size-2.5 shrink-0 rounded-full", m.isVeg ? "bg-basil" : "bg-chili")} title={m.isVeg ? "Veg" : "Non-veg"} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.name}</span>
                  <span className="tabular text-sm text-muted-foreground">{formatMoney(m.price)}</span>
                </span>
                {qty > 0 && (
                  <button onClick={() => setNoteFor(noteFor === m.id ? null : m.id)} className={cn("rounded-md p-2", line?.notes ? "text-turmeric" : "text-muted-foreground")} aria-label="Cooking note">
                    <StickyNote className="size-4" />
                  </button>
                )}
                {qty === 0 ? (
                  <button onClick={() => change(m.id, 1)} className="rounded-lg border border-ink px-4 py-1.5 text-sm font-semibold">
                    Add
                  </button>
                ) : (
                  <span className="flex items-center rounded-lg bg-ink text-white">
                    <button onClick={() => change(m.id, -1)} className="p-2" aria-label={`One less ${m.name}`}>
                      <Minus className="size-4" />
                    </button>
                    <span className="tabular w-6 text-center font-semibold">{qty}</span>
                    <button onClick={() => change(m.id, 1)} className="p-2" aria-label={`One more ${m.name}`}>
                      <Plus className="size-4" />
                    </button>
                  </span>
                )}
              </div>
              {noteFor === m.id && line && (
                <input
                  autoFocus
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ink"
                  placeholder="e.g. less spicy, no onion"
                  value={line.notes}
                  onChange={(e) => setCart((c) => c.map((l) => (l.menuItemId === m.id ? { ...l, notes: e.target.value } : l)))}
                  onKeyDown={(e) => e.key === "Enter" && setNoteFor(null)}
                />
              )}
            </li>
          );
        })}
        {visible.length === 0 && <li className="px-4 py-12 text-center text-muted-foreground">No foods match.</li>}
      </ul>

      <div className="fixed inset-x-0 bottom-0 border-t bg-card/95 p-3 backdrop-blur">
        <button
          onClick={send}
          disabled={busy || count === 0}
          className="mx-auto flex h-12 w-full max-w-xl items-center justify-center gap-2 rounded-lg bg-ink text-base font-semibold text-white disabled:bg-steel disabled:text-muted-foreground"
        >
          {count === 0 ? "Add foods to send" : busy ? "Sending…" : `Send to kitchen · ${count} ${count === 1 ? "item" : "items"} · ${formatMoney(amount)}`}
        </button>
      </div>
    </div>
  );
}
