import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export interface RealtimeEvent {
  type: "order.created" | "items.added" | "order.updated" | "item.updated";
  restaurantId: number;
  orderId: number;
  orderNo?: number;
  orderType?: string;
  status?: string;
  tableName?: string | null;
  /** Items just sent to the kitchen (order.created / items.added). */
  itemIds?: number[];
  /** Role of whoever caused the event, e.g. "waiter". */
  source?: string;
  categoryIds?: number[];
}

/** Broadcast through Postgres NOTIFY; the ws service LISTENs and fans out to sockets. */
export async function publish(event: RealtimeEvent): Promise<void> {
  try {
    await db.execute(sql`select pg_notify('rms_events', ${JSON.stringify(event)})`);
  } catch (err) {
    console.error("Failed to publish event", err);
  }
}
