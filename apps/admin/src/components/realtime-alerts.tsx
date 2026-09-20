import { useEffect } from "react";
import { toast } from "sonner";
import { api, type Order, type RealtimeEvent } from "@workspace/shared";
import { useBootstrap } from "../lib/session";
import { useRealtime } from "../lib/hooks";
import { autoPrintWaiterKot, printOrder } from "../lib/print";

/** System notification when the window isn't in front; the toast covers the rest. */
function notify(title: string, body: string) {
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: title });
  } catch {
    // ignore: the toast already showed
  }
}

/**
 * Restaurant-wide live alerts for billing staff: new table orders from waiters,
 * tables ready for the bill, takeaway ready to pack. Also prints waiter KOTs when this computer is set to.
 */
export function RealtimeAlerts() {
  const { data: setup } = useBootstrap();

  useEffect(() => {
    if ("Notification" in window && window.isSecureContext && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useRealtime(async (e: RealtimeEvent) => {
    const where = e.tableName ? `Table ${e.tableName}` : `Order #${e.orderNo}`;

    if (e.source === "waiter" && (e.type === "order.created" || e.type === "items.added")) {
      const count = e.itemIds?.length ?? 0;
      const title = `${where}: ${e.type === "order.created" ? "new order" : "more items"}`;
      toast.info(title, { description: `${count} ${count === 1 ? "item" : "items"} sent to the kitchen` });
      notify(title, `${count} ${count === 1 ? "item" : "items"} sent to the kitchen`);
      if (autoPrintWaiterKot() && setup && e.itemIds?.length) {
        try {
          const order = await api<Order>(`/orders/${e.orderId}`);
          const results = await printOrder(order, setup, { kot: true, bill: false, itemIds: e.itemIds });
          for (const r of results.filter((r) => !r.ok)) toast.error(`${r.label}: ${r.error}`);
        } catch (err) {
          toast.error(`Couldn't print the KOT for ${where}: ${(err as Error).message}`);
        }
      }
      return;
    }

    if (e.type === "order.updated" && e.status === "served") {
      toast.success(`${where} is ready for the bill`, { description: "Everything's been served. Settle it from Tables." });
      notify(`${where} is ready for the bill`, "Everything's been served.");
    } else if (e.type === "order.updated" && e.status === "packing") {
      toast.success(`${where} is ready to pack`);
      notify(`${where} is ready to pack`, "Every food is cooked.");
    }
  });

  return null;
}
