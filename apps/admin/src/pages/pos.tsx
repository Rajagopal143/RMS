import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Minus, Plus, Search, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select";
import { cn } from "@workspace/ui/lib/utils";
import {
  api,
  formatMoney,
  ORDER_TYPE_LABEL,
  ORDER_TYPES,
  PAYMENT_MODES,
  type MenuItem,
  type Order,
  type OrderType,
  type PaymentMode,
  type TableStatus,
} from "@workspace/shared";
import { useBootstrap } from "../lib/session";
import { printOrder } from "../lib/print";
import { toPaise, useApi } from "../lib/hooks";
import { EmptyState, ColorDot } from "../components/bits";

interface CartLine {
  menuItemId: number;
  qty: number;
  notes: string;
}

export function PosPage() {
  const { data: setup } = useBootstrap();
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState<OrderType>("dine_in");
  const [tableId, setTableId] = useState<number | null>(Number(params.get("table")) || null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [discount, setDiscount] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [printKot, setPrintKot] = useState(true);
  const [printBill, setPrintBill] = useState(true);
  const [busy, setBusy] = useState(false);

  const { categories, menuItems } = setup!;
  const tables = useApi<TableStatus[]>("/tables/status");
  const byId = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);
  const categoryColor = (id: number | null) => categories.find((c) => c.id === id)?.color ?? "#9aa0a6";

  const visible = menuItems.filter(
    (m) =>
      (categoryId === "all" || m.categoryId === categoryId) &&
      (!query || m.name.toLowerCase().includes(query.toLowerCase())),
  );

  const lines = cart.map((l) => ({ ...l, item: byId.get(l.menuItemId)! })).filter((l) => l.item);
  const subtotal = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const discountPaise = Math.min(toPaise(discount), subtotal);
  const dineIn = type === "dine_in";
  const total = subtotal - (dineIn ? 0 : discountPaise);
  const openOrder = tables.data?.find((t) => t.id === tableId)?.order ?? null;

  function add(item: MenuItem) {
    if (!item.isAvailable) return;
    setCart((c) => {
      const found = c.find((l) => l.menuItemId === item.id && !l.notes);
      if (found) return c.map((l) => (l === found ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { menuItemId: item.id, qty: 1, notes: "" }];
    });
  }

  function change(index: number, patch: Partial<CartLine>) {
    setCart((c) => c.map((l, i) => (i === index ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  }

  function reset() {
    setCart([]);
    setTableId(null);
    if (params.has("table")) setParams({}, { replace: true });
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setDiscount("");
    setNoteFor(null);
  }

  async function placeOrder() {
    setBusy(true);
    try {
      const order = await api<Order & { addedItemIds: number[]; noCookCategories: string[] }>("/orders", {
        method: "POST",
        body: {
          type,
          tableId: dineIn ? tableId : null,
          customerName: customerName || null,
          customerPhone: customerPhone || null,
          customerAddress: type === "delivery" ? customerAddress : null,
          discount: discountPaise,
          paymentMode,
          items: cart.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, notes: l.notes || null })),
        },
      });
      toast.success(dineIn ? `Sent to the kitchen for table ${order.tableNo}` : `Order #${order.orderNo} sent to the kitchen`);
      reset();
      void tables.reload();
      if (order.noCookCategories.length) {
        toast.warning(`No cook is assigned to ${order.noCookCategories.join(", ")}`, {
          description: "Those foods won't show on any kitchen screen. Give a cook that category in Staff logins.",
          duration: 12000,
        });
      }
      // Table bills print when the table settles; only this round's KOT prints now.
      const bill = printBill && !dineIn;
      if (printKot || bill) {
        const results = await printOrder(order, setup!, { kot: printKot, bill, itemIds: order.addedItemIds });
        for (const r of results.filter((r) => !r.ok)) toast.error(`${r.label}: ${r.error}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (menuItems.length === 0) {
    return (
      <EmptyState title="Your menu is empty" action={<Button asChild><a href="#/menu">Add menu items</a></Button>}>
        Add foods and give each one a category, then come back here to bill.
      </EmptyState>
    );
  }

  const missing =
    cart.length === 0
      ? "Add items to start an order"
      : dineIn && !tableId
        ? "Pick a table"
        : type === "delivery" && !customerAddress
          ? "Enter the delivery address"
          : null;

  return (
    <div className="-mx-4 -my-5 grid grid-cols-[minmax(0,1fr)] sm:-mx-6 lg:-mx-8 lg:-my-7 lg:h-svh lg:grid-cols-[1fr_400px]">
      {/* Menu */}
      <section className="flex min-h-0 flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold sm:text-3xl">Billing</h1>
          <div className="relative w-full sm:ml-auto sm:w-72">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search dishes" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {[{ id: "all" as const, name: "All" }, ...categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                categoryId === c.id ? "border-ink bg-ink text-white" : "bg-card hover:border-ink/40",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 pb-6 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] lg:overflow-y-auto lg:pr-1">
          {visible.map((m) => (
            <button
              key={m.id}
              onClick={() => add(m)}
              disabled={!m.isAvailable}
              className="group relative flex min-h-24 flex-col justify-between rounded-lg border bg-card p-3 text-left transition hover:-translate-y-0.5 hover:border-ink/40 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
              style={{ boxShadow: `inset 0 3px 0 ${categoryColor(m.categoryId)}` }}
            >
              <span className="flex items-start gap-1.5 text-sm font-medium leading-snug">
                <span
                  className={cn("mt-1 size-2.5 shrink-0 rounded-[2px] border", m.isVeg ? "border-basil" : "border-chili")}
                  title={m.isVeg ? "Veg" : "Non-veg"}
                >
                  <span className={cn("m-[2px] block size-1 rounded-full", m.isVeg ? "bg-basil" : "bg-chili")} />
                </span>
                {m.name}
              </span>
              <span className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular text-sm text-foreground">{formatMoney(m.price)}</span>
                {!m.isAvailable && "Sold out"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Phones: the order ticket sits below the menu, so offer a jump to it. */}
      {cart.length > 0 && (
        <button
          onClick={() => document.getElementById("order-ticket")?.scrollIntoView({ behavior: "smooth" })}
          className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white shadow-lg lg:hidden"
        >
          View order · {cart.reduce((n, l) => n + l.qty, 0)} items · {formatMoney(total)}
        </button>
      )}

      {/* Order ticket */}
      <aside id="order-ticket" className="flex min-h-0 flex-col border-t bg-steel/60 p-4 sm:p-5 lg:border-l lg:border-t-0">
        <div className="ticket flex min-h-[420px] flex-1 flex-col px-5 pt-4 lg:min-h-0" style={{ ["--ticket-accent" as string]: "var(--color-ink)" }}>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1 font-sans">
            {ORDER_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn("rounded px-2 py-1.5 text-sm", type === t ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}
              >
                {ORDER_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 font-sans">
            {type === "dine_in" &&
              (tables.data?.length === 0 ? (
                <a href="#/tables" className="col-span-2 rounded-md bg-turmeric-soft px-3 py-2 text-sm">
                  No tables yet. <span className="font-semibold underline">Add tables</span>
                </a>
              ) : (
              <NativeSelect className="w-full" value={tableId ?? ""} onChange={(e) => setTableId(Number(e.target.value) || null)} aria-label="Table">
                <NativeSelectOption value="">Pick a table</NativeSelectOption>
                {(tables.data ?? []).map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    {t.name}
                    {t.order ? ` · open ${formatMoney(t.order.total)}` : " · free"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              ))}
            <Input placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} aria-label="Customer name" />
            {type !== "dine_in" && (
              <Input placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} aria-label="Phone" />
            )}
            {type === "delivery" && (
              <Input
                className="col-span-2"
                placeholder="Delivery address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                aria-label="Delivery address"
              />
            )}
          </div>

          <hr className="ticket-rule my-3" />

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {lines.length === 0 && <p className="py-10 text-center text-muted-foreground">Tap dishes to add them</p>}
            {lines.map((l, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <ColorDot color={categoryColor(l.item.categoryId)} />
                  <span className="min-w-0 flex-1 truncate">{l.item.name}</span>
                  <button className="rounded p-1 hover:bg-muted" onClick={() => change(i, { qty: l.qty - 1 })} aria-label="Less">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-5 text-center">{l.qty}</span>
                  <button className="rounded p-1 hover:bg-muted" onClick={() => change(i, { qty: l.qty + 1 })} aria-label="More">
                    <Plus className="size-3.5" />
                  </button>
                  <span className="w-20 text-right">{formatMoney(l.item.price * l.qty)}</span>
                  <button
                    className={cn("rounded p-1 hover:bg-muted", l.notes && "text-turmeric")}
                    onClick={() => setNoteFor(noteFor === i ? null : i)}
                    aria-label="Cooking note"
                  >
                    <StickyNote className="size-3.5" />
                  </button>
                </div>
                {noteFor === i && (
                  <div className="mt-1 flex gap-1 pl-4">
                    <Input
                      autoFocus
                      className="h-8 font-sans text-xs"
                      placeholder="e.g. less spicy, no onion"
                      value={l.notes}
                      onChange={(e) => change(i, { notes: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && setNoteFor(null)}
                    />
                    <button onClick={() => change(i, { notes: "" })} className="p-1" aria-label="Clear note">
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
                {noteFor !== i && l.notes && <p className="pl-4 text-xs text-muted-foreground">› {l.notes}</p>}
              </div>
            ))}
          </div>

          <hr className="ticket-rule my-3" />
          <div className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatMoney(subtotal)} />
            {!dineIn && (
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
            )}
            <div className="flex justify-between pt-1 text-lg font-bold">
              <span>{dineIn && openOrder ? "Adding" : "Total"}</span>
              <span>{formatMoney(total)}</span>
            </div>
            {dineIn && openOrder && (
              <p className="text-xs text-muted-foreground">
                Table {openOrder.tableNo} already has {formatMoney(openOrder.total)} open. The bill is settled from Tables.
              </p>
            )}
          </div>
          {!dineIn && (
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
          )}
          <div className="mb-2 mt-3 flex gap-5 font-sans text-sm">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={printKot} onCheckedChange={(v) => setPrintKot(v === true)} /> Print KOT
            </Label>
            {!dineIn && (
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={printBill} onCheckedChange={(v) => setPrintBill(v === true)} /> Print bill
              </Label>
            )}
          </div>
        </div>
        <Button size="lg" className="mt-4 h-12 text-base" disabled={busy || !!missing} onClick={placeOrder}>
          {busy ? "Sending…" : (missing ?? (dineIn ? `Send to kitchen · ${formatMoney(total)}` : `Place order · ${formatMoney(total)}`))}
        </Button>
      </aside>
    </div>
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
