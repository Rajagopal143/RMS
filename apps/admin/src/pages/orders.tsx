import { Check, Printer, ReceiptText, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { api, formatMoney, ORDER_TYPE_LABEL, type Order, type OrderStatus } from "@workspace/shared";
import { useBootstrap } from "../lib/session";
import { todayIso, useApi, useRealtime } from "../lib/hooks";
import { printOrder } from "../lib/print";
import { ErrorNote, PageHeader, ColorDot, StatusPill, minutesSince } from "../components/bits";

/** One row per stage an order passes through, top to bottom. */
const ROWS: { statuses: OrderStatus[]; title: string; hint: string; accent: string }[] = [
  { statuses: ["placed"], title: "In queue", hint: "Sent to the cooks, nobody has started yet", accent: "var(--color-steel)" },
  { statuses: ["cooking"], title: "In kitchen", hint: "At least one food is being cooked", accent: "var(--color-turmeric)" },
  { statuses: ["packing", "serving", "served"], title: "Ready", hint: "Takeaway to pack, table food to serve, tables waiting for the bill", accent: "var(--color-basil)" },
  { statuses: ["completed"], title: "Completed", hint: "Handed over or paid today", accent: "var(--color-ink)" },
];

export function OrdersPage() {
  const { data: setup } = useBootstrap();
  // Open orders from any day, plus everything from today (so completed ones show).
  const open = useApi<Order[]>("/orders?status=active");
  const today = useApi<Order[]>(`/orders?date=${todayIso()}`);
  const error = open.error ?? today.error;
  const reload = async () => {
    await Promise.all([open.reload(), today.reload()]);
  };
  const orders = open.data && today.data ? [...new Map([...today.data, ...open.data].map((o) => [o.id, o])).values()] : null;
  const live = useRealtime(() => void reload());

  const categoryColor = (id: number | null) => setup!.categories.find((c) => c.id === id)?.color ?? "#9aa0a6";

  async function reprint(order: Order, what: { kot: boolean; bill: boolean }) {
    const results = await printOrder(order, setup!, what);
    if (results.length === 0) toast.info("No printer is set up for this");
    for (const r of results) {
      if (r.ok) toast.success(`Printed ${r.label}`);
      else toast.error(`${r.label}: ${r.error}`);
    }
  }

  async function cancel(order: Order) {
    if (!confirm(`Cancel order #${order.orderNo}? The kitchen will stop cooking it.`)) return;
    try {
      await api(`/orders/${order.id}/cancel`, { method: "POST" });
      toast.success(`Order #${order.orderNo} cancelled`);
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handOver(order: Order) {
    try {
      await api(`/packing/orders/${order.id}/complete`, { method: "POST" });
      void reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const cancelled = orders?.filter((o) => o.status === "cancelled").length ?? 0;

  return (
    <div>
      <PageHeader
        title="Live orders"
        description="Every open order, and today's completed ones, moving down as cooks start and finish each food."
        actions={
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn("size-2 rounded-full", live ? "bg-basil" : "bg-chili")} />
            {live ? "Live" : "Reconnecting…"}
          </span>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="space-y-4">
        {ROWS.map((row) => {
          const list = (orders ?? []).filter((o) => row.statuses.includes(o.status));
          return (
            <section key={row.title} className="rounded-xl border bg-card/60" style={{ boxShadow: `inset 4px 0 0 ${row.accent}` }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 pb-2 pt-3">
                <h2 className="text-lg font-semibold">{row.title}</h2>
                <span className="tabular rounded-full bg-ink px-2 text-xs font-semibold leading-5 text-white">{list.length}</span>
                <span className="text-xs text-muted-foreground">{row.hint}</span>
              </div>
              <div className="flex gap-3 overflow-x-auto px-4 pb-4">
                {list.length === 0 && <p className="py-3 text-sm text-muted-foreground">Nothing here right now.</p>}
                {list.map((o) => (
                  <article key={o.id} className="w-64 shrink-0 rounded-lg border bg-card p-3 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="tabular text-base font-bold">#{o.orderNo}</span>
                      <span className="text-xs text-muted-foreground">
                        {o.tableNo ? `Table ${o.tableNo}` : ORDER_TYPE_LABEL[o.type]} · {minutesSince(o.createdAt)}m
                      </span>
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {o.items.map((i) => (
                        <li key={i.id} className={cn("flex items-center gap-1.5", i.status === "done" && "text-muted-foreground")}>
                          <ColorDot color={categoryColor(i.categoryId)} />
                          <span className="min-w-0 flex-1 truncate">
                            {i.qty} × {i.name}
                          </span>
                          {i.status === "done" && <span className="text-[11px] font-semibold text-basil">READY</span>}
                          {i.status === "served" && <Check className="size-3.5 text-basil" />}
                          {i.status === "cooking" && <span className="text-[11px] font-semibold text-turmeric">COOKING</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex items-center justify-between border-t pt-2">
                      <span className="tabular font-semibold">{formatMoney(o.total)}</span>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="size-7" title="Reprint KOT" onClick={() => reprint(o, { kot: true, bill: false })}>
                          <Printer className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" title="Reprint bill" onClick={() => reprint(o, { kot: false, bill: true })}>
                          <ReceiptText className="size-3.5" />
                        </Button>
                        {o.status !== "completed" && (
                          <Button size="icon" variant="ghost" className="size-7 text-chili" title="Cancel order" onClick={() => cancel(o)}>
                            <X className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {o.status === "serving" && <p className="mt-2 text-xs font-semibold text-basil">Waiter to serve · settle from Tables</p>}
                    {o.status === "served" && <p className="mt-2 text-xs text-muted-foreground">Settle this bill from Tables</p>}
                    {o.status === "packing" && (
                      <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => handOver(o)}>
                        Mark handed over
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {cancelled > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          {cancelled} cancelled today · <StatusPill status="cancelled" />
        </p>
      )}
    </div>
  );
}
