import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChefHat, Flame, Plus, Printer, ReceiptText, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { api, formatMoney, PAYMENT_MODES, type Order, type DiningTable, type OrderItem, type PaymentMode, type TableStatus } from "@workspace/shared";
import { useBootstrap, useSession } from "../lib/session";
import { toPaise, useApi, useRealtime } from "../lib/hooks";
import { printOrder } from "../lib/print";
import { ColorDot, EmptyState, ErrorNote, FormField, PageHeader, minutesSince } from "../components/bits";

function tableState(order: Order | null) {
  if (!order) return { label: "Free", cls: "bg-steel text-muted-foreground" };
  if (order.items.some((i) => i.status === "done")) return { label: "Food ready to serve", cls: "bg-basil text-white" };
  if (order.items.some((i) => i.status === "pending" || i.status === "cooking")) return { label: "In kitchen", cls: "bg-turmeric-soft text-ink" };
  return { label: "Awaiting bill", cls: "bg-ink text-white" };
}

const ITEM_STATE: Record<OrderItem["status"], { label: string; icon: React.ReactNode }> = {
  pending: { label: "Waiting", icon: <ChefHat className="size-3.5 text-muted-foreground" /> },
  cooking: { label: "Cooking", icon: <Flame className="size-3.5 text-turmeric" /> },
  done: { label: "Ready", icon: <span className="size-2 rounded-full bg-basil" /> },
  served: { label: "Served", icon: <Check className="size-3.5 text-basil" /> },
};

export function TablesPage() {
  const { user } = useSession();
  const { data: setup, reload: reloadSetup } = useBootstrap();
  const { data: tables, error, reload } = useApi<TableStatus[]>("/tables/status");
  const live = useRealtime(() => void reload());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  const isManager = user?.role === "owner" || user?.role === "manager";

  const selected = tables?.find((t) => t.id === selectedId) ?? null;
  const occupied = tables?.filter((t) => t.order).length ?? 0;
  const openTotal = tables?.reduce((s, t) => s + (t.order?.total ?? 0), 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Tables"
        description="What every table has ordered, live. Settle a table here to print its bill and free it."
        actions={
          <>
            <span className="inline-flex items-center gap-2 self-center text-sm text-muted-foreground">
              <span className={cn("size-2 rounded-full", live ? "bg-basil" : "bg-chili")} />
              {occupied} of {tables?.length ?? 0} occupied · {formatMoney(openTotal)} open
            </span>
            {isManager && (
              <Button variant="outline" onClick={() => setManaging(true)}>
                <Settings2 /> Manage tables
              </Button>
            )}
          </>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {tables && tables.length === 0 ? (
        <EmptyState title="No tables yet" action={isManager && <Button onClick={() => setManaging(true)}>Add tables</Button>}>
          Add your dining tables so waiters can take orders against them.
        </EmptyState>
      ) : (
        <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-6", selected && "lg:grid-cols-[1fr_400px]")}>
          <div className="grid auto-rows-min grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
            {tables?.map((t) => {
              const state = tableState(t.order);
              const items = t.order?.items ?? [];
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                  className={cn(
                    "flex min-h-32 flex-col rounded-xl border bg-card p-3 text-left transition hover:border-ink/40",
                    t.id === selectedId && "border-ink ring-2 ring-ink",
                  )}
                >
                  <span className="flex items-baseline justify-between">
                    <span className="font-display text-3xl font-semibold">{t.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.order ? `${minutesSince(t.order.createdAt)} min` : `${t.seats} seats`}
                    </span>
                  </span>
                  <span className={cn("mt-1 w-fit rounded-full px-2 py-0.5 text-xs font-semibold", state.cls)}>{state.label}</span>
                  {t.order && (
                    <>
                      <span className="mt-auto flex gap-0.5 pt-3">
                        {items.map((i) => (
                          <span
                            key={i.id}
                            className={cn("h-1.5 flex-1 rounded-full", i.status === "pending" && "bg-steel", i.status === "cooking" && "bg-turmeric", i.status === "done" && "bg-basil", i.status === "served" && "bg-ink")}
                          />
                        ))}
                      </span>
                      <span className="mt-2 flex items-baseline justify-between text-sm">
                        <span className="text-muted-foreground">
                          #{t.order.orderNo} · {items.reduce((n, i) => n + i.qty, 0)} items
                        </span>
                        <span className="tabular font-semibold">{formatMoney(t.order.total)}</span>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {selected && setup && (
            // On phones the selected table's panel sits above the grid, where the tap happened.
            <div className="order-first lg:order-none">
              <TablePanel table={selected} onChanged={reload} onClose={() => setSelectedId(null)} />
            </div>
          )}
        </div>
      )}
      {managing && (
        <ManageTables
          onClose={() => setManaging(false)}
          onChanged={async () => {
            await Promise.all([reload(), reloadSetup()]);
          }}
        />
      )}
    </div>
  );
}

function TablePanel({ table, onChanged, onClose }: { table: TableStatus; onChanged: () => Promise<void>; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: setup } = useBootstrap();
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);
  const order = table.order;
  const categoryColor = (id: number | null) => setup!.categories.find((c) => c.id === id)?.color ?? "#9aa0a6";

  async function print(what: { kot: boolean; bill: boolean }, target: Order) {
    const results = await printOrder(target, setup!, what);
    if (results.length === 0) toast.info("No printer is set up for this");
    for (const r of results) {
      if (r.ok) toast.success(`Printed ${r.label}`);
      else toast.error(`${r.label}: ${r.error}`);
    }
  }

  if (!order) {
    return (
      <aside className="ticket h-fit px-5 pb-6 pt-4">
        <p className="font-display text-3xl font-semibold">Table {table.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">Free · {table.seats} seats</p>
        <Button className="mt-4 w-full font-sans" onClick={() => navigate(`/pos?table=${table.id}`)}>
          <Plus /> Start an order
        </Button>
      </aside>
    );
  }

  const inKitchen = order.items.filter((i) => i.status === "pending" || i.status === "cooking");
  const discountPaise = Math.min(toPaise(discount), order.subtotal);
  const payable = order.subtotal - discountPaise;
  const rounds = [...new Set(order.items.map((i) => i.round))];

  async function settle() {
    setBusy(true);
    try {
      const closed = await api<Order>(`/orders/${order!.id}/settle`, { method: "POST", body: { paymentMode, discount: discountPaise } });
      toast.success(`Table ${table.name} settled · ${formatMoney(closed.total)} by ${paymentMode.toUpperCase()}`);
      await print({ kot: false, bill: true }, closed);
      setDiscount("");
      onClose();
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm(`Cancel order #${order!.orderNo} for table ${table.name}? The kitchen stops cooking it and the table is freed.`)) return;
    try {
      await api(`/orders/${order!.id}/cancel`, { method: "POST" });
      onClose();
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <aside className="ticket h-fit px-5 pt-4" style={{ ["--ticket-accent" as string]: "var(--color-ink)" }}>
      <div className="flex items-baseline justify-between">
        <p className="font-display text-3xl font-semibold">Table {table.name}</p>
        <span className="text-sm text-muted-foreground">
          #{order.orderNo} · {minutesSince(order.createdAt)} min
        </span>
      </div>
      <hr className="ticket-rule my-3" />
      <div className="max-h-[42vh] space-y-3 overflow-y-auto">
        {rounds.map((round) => (
          <div key={round}>
            {rounds.length > 1 && <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Round {round}</p>}
            <ul className="space-y-1">
              {order.items
                .filter((i) => i.round === round)
                .map((i) => (
                  <li key={i.id} className={cn("flex items-center gap-2", i.status === "served" && "text-muted-foreground")}>
                    <ColorDot color={categoryColor(i.categoryId)} />
                    <span className="min-w-0 flex-1 truncate">
                      {i.qty} × {i.name}
                    </span>
                    <span className="inline-flex items-center gap-1 font-sans text-xs" title={ITEM_STATE[i.status].label}>
                      {ITEM_STATE[i.status].icon}
                      {ITEM_STATE[i.status].label}
                    </span>
                    <span className="w-20 text-right">{formatMoney(i.price * i.qty)}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <hr className="ticket-rule my-3" />
      <div className="space-y-1 text-sm">
        <Row label="Subtotal" value={formatMoney(order.subtotal)} />
        <div className="flex items-center justify-between">
          <span>Discount ₹</span>
          <Input
            className="h-7 w-24 text-right font-mono"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Discount in rupees"
          />
        </div>
        <div className="flex justify-between pt-1 text-lg font-bold">
          <span>To pay</span>
          <span>{formatMoney(payable)}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 font-sans">
        {PAYMENT_MODES.map((m) => (
          <button
            key={m}
            onClick={() => setPaymentMode(m)}
            className={cn("rounded border py-1.5 text-sm uppercase", paymentMode === m ? "border-ink bg-ink text-white" : "bg-card")}
          >
            {m}
          </button>
        ))}
      </div>
      {inKitchen.length > 0 && (
        <p className="mt-3 rounded bg-turmeric-soft px-2 py-1.5 font-sans text-xs">
          {inKitchen.length} {inKitchen.length === 1 ? "food is" : "foods are"} still in the kitchen. You can settle once {inKitchen.length === 1 ? "it's" : "they're"} ready.
        </p>
      )}
      <Button size="lg" className="mt-3 h-11 w-full font-sans" disabled={busy || inKitchen.length > 0} onClick={settle}>
        <ReceiptText /> Settle & print bill · {formatMoney(payable)}
      </Button>
      <div className="mb-3 mt-2 grid grid-cols-3 gap-1.5 font-sans">
        <Button size="sm" variant="outline" onClick={() => navigate(`/pos?table=${table.id}`)}>
          <Plus /> Add items
        </Button>
        <Button size="sm" variant="outline" onClick={() => print({ kot: false, bill: true }, { ...order, discount: discountPaise, total: payable, paymentMode })}>
          <ReceiptText /> Print bill
        </Button>
        <Button size="sm" variant="outline" onClick={() => print({ kot: true, bill: false }, order)}>
          <Printer /> KOT
        </Button>
      </div>
      <button onClick={cancel} className="mb-3 w-full font-sans text-xs text-chili underline">
        Cancel this order
      </button>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ManageTables({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const { data: setup } = useBootstrap();
  // Local copy so every change shows at once; the pages behind refresh in the background.
  const [tables, setTables] = useState<DiningTable[]>(setup!.tables);
  const nextName = (list: DiningTable[]) => {
    const used = new Set(list.map((t) => t.name.toLowerCase()));
    let n = list.length + 1;
    while (used.has(`t${n}`)) n++;
    return `T${n}`;
  };
  const [name, setName] = useState(() => nextName(setup!.tables));
  const [seats, setSeats] = useState("4");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const created = await api<DiningTable>("/tables", { method: "POST", body: { name: name.trim(), seats: Number(seats), sortOrder: tables.length + 1 } });
      const next = [...tables, created];
      setTables(next);
      setName(nextName(next));
      toast.success(`Table ${created.name} added`);
      void onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: DiningTable, isActive: boolean) {
    setTables((list) => list.map((x) => (x.id === t.id ? { ...x, isActive } : x)));
    try {
      await api(`/tables/${t.id}`, { method: "PATCH", body: { isActive } });
      void onChanged();
    } catch (e) {
      setTables((list) => list.map((x) => (x.id === t.id ? { ...x, isActive: !isActive } : x)));
      toast.error((e as Error).message);
    }
  }

  async function remove(t: DiningTable) {
    if (!confirm(`Delete table ${t.name}?`)) return;
    try {
      await api(`/tables/${t.id}`, { method: "DELETE" });
      setTables((list) => list.filter((x) => x.id !== t.id));
      toast.success(`Table ${t.name} deleted`);
      void onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const duplicate = tables.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tables</DialogTitle>
          <DialogDescription>Waiters see these on their phones. Turn a table off to hide it without deleting its history.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {tables.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No tables yet. Add your first one below.</p>}
          {tables.map((t) => (
            <div key={t.id} className={cn("flex items-center gap-3 rounded-md px-1 py-1.5", !t.isActive && "opacity-50")}>
              <span className="w-16 font-display text-lg font-semibold">{t.name}</span>
              <span className="flex-1 text-sm text-muted-foreground">{t.seats} seats</span>
              <Switch checked={t.isActive} onCheckedChange={(v) => toggle(t, v)} aria-label={`${t.name} in use`} />
              <Button size="icon" variant="ghost" className="size-8 text-chili" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <form
          className="grid grid-cols-[1fr_80px_auto] items-end gap-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name.trim() && Number(seats) && !duplicate) void add();
          }}
        >
          <FormField label="Table name" htmlFor="t-name">
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={duplicate} />
          </FormField>
          <FormField label="Seats" htmlFor="t-seats">
            <Input id="t-seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} />
          </FormField>
          <Button type="submit" disabled={busy || !name.trim() || !Number(seats) || duplicate}>
            <Plus /> {busy ? "Adding…" : "Add"}
          </Button>
          {duplicate && <p className="col-span-3 text-xs text-chili">There's already a table called {name.trim()}.</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
