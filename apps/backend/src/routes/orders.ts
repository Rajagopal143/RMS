import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, lt, max, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { categories, db, diningTables, expenses, menuItems, orderItems, orders, users } from "@workspace/db";
import { requireRole, restaurantId } from "../lib/auth.js";
import { publish, type RealtimeEvent } from "../lib/events.js";
import { HttpError, idParam, notFound, parse } from "../lib/http.js";

/** Billing, table service, kitchen and packing. */
export const ordersRouter = Router();

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CLOSED = ["completed", "cancelled"] as const;

async function withItems(rows: OrderRow[]) {
  if (rows.length === 0) return [];
  const items = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((o) => o.id)))
    .orderBy(asc(orderItems.id));
  return rows.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id) }));
}

async function loadOrder(rid: number, id: number) {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.restaurantId, rid)));
  if (!order) throw notFound("Order");
  return (await withItems([order]))[0]!;
}

const categoriesOf = (items: { categoryId: number | null }[]) => [
  ...new Set(items.map((i) => i.categoryId).filter((c): c is number => c !== null)),
];

function orderEvent(type: RealtimeEvent["type"], order: OrderRow, extra: Partial<RealtimeEvent> = {}): RealtimeEvent {
  return {
    type,
    restaurantId: order.restaurantId,
    orderId: order.id,
    orderNo: order.orderNo,
    orderType: order.type,
    status: order.status,
    tableName: order.tableNo,
    ...extra,
  };
}

/**
 * Derives the order status from its items; returns the updated order if it changed.
 * Kitchen first (placed → cooking); then takeaway/delivery go to packing, and dine-in
 * goes to the waiter (serving) until every item is at the table (served).
 */
async function syncOrderStatus(orderId: number): Promise<OrderRow | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.status === "completed" || order.status === "cancelled") return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const inKitchen = items.some((i) => i.status === "pending" || i.status === "cooking");
  let next: OrderRow["status"];
  if (inKitchen) next = items.some((i) => i.status !== "pending") ? "cooking" : "placed";
  else if (order.type !== "dine_in") next = "packing";
  else next = items.some((i) => i.status === "done") ? "serving" : "served";
  if (next === order.status) return null;
  const [updated] = await db
    .update(orders)
    .set({ status: next, cookedAt: inKitchen ? null : (order.cookedAt ?? new Date()) })
    .where(eq(orders.id, orderId))
    .returning();
  return updated ?? null;
}

/** Names of the given categories that no active cook is assigned to: their foods won't show on any kitchen screen. */
async function categoriesWithoutCook(rid: number, categoryIds: number[]): Promise<string[]> {
  if (categoryIds.length === 0) return [];
  const cooks = await db
    .select({ categoryIds: users.categoryIds })
    .from(users)
    .where(and(eq(users.restaurantId, rid), eq(users.role, "cook"), eq(users.isActive, true)));
  const covered = new Set(cooks.flatMap((c) => c.categoryIds));
  const missing = categoryIds.filter((id) => !covered.has(id));
  if (missing.length === 0) return [];
  const rows = await db.select({ name: categories.name }).from(categories).where(inArray(categories.id, missing));
  return rows.map((r) => r.name);
}

// ---- Taking orders: cashier billing and waiter table service ----

const lineInput = z.object({
  menuItemId: z.number().int(),
  qty: z.number().int().min(1).max(99),
  notes: z.string().trim().nullish(),
});

const orderInput = z.object({
  type: z.enum(["dine_in", "takeaway", "delivery"]),
  tableId: z.number().int().nullish(),
  customerName: z.string().trim().nullish(),
  customerPhone: z.string().trim().nullish(),
  customerAddress: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
  discount: z.number().int().min(0).default(0),
  paymentMode: z.enum(["cash", "upi", "card"]).nullish(),
  items: z.array(lineInput).min(1, "Add at least one item"),
});

/** Resolves ordered lines against the menu and prices them. No tax is charged. */
async function priceLines(rid: number, input: z.infer<typeof lineInput>[]) {
  const ids = [...new Set(input.map((i) => i.menuItemId))];
  const menu = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.restaurantId, rid), inArray(menuItems.id, ids)));
  const lines = input.map((line) => {
    const item = menu.find((m) => m.id === line.menuItemId);
    if (!item) throw new HttpError(400, "An item on this order is no longer on the menu");
    if (!item.isAvailable) throw new HttpError(400, `${item.name} is sold out`);
    return { line, item };
  });
  const subtotal = lines.reduce((s, { line, item }) => s + item.price * line.qty, 0);
  return { lines, subtotal };
}

async function insertItems(tx: Tx, order: OrderRow, lines: Awaited<ReturnType<typeof priceLines>>["lines"], round: number, userId: number) {
  return tx
    .insert(orderItems)
    .values(
      lines.map(({ line, item }) => ({
        orderId: order.id,
        restaurantId: order.restaurantId,
        menuItemId: item.id,
        // Foods without a category have no cook to go to (e.g. bottled water): they skip the kitchen.
        categoryId: item.categoryId,
        name: item.name,
        price: item.price,
        qty: line.qty,
        notes: line.notes,
        round,
        addedBy: userId,
        status: item.categoryId === null ? ("done" as const) : ("pending" as const),
        doneAt: item.categoryId === null ? new Date() : null,
      })),
    )
    .returning();
}

/**
 * Creates an order, or, for a table that already has an open order, adds the items to it as a new round.
 * Items go straight to the cooks of their categories. Dine-in is billed later, when the table settles.
 */
ordersRouter.post("/orders", requireRole("owner", "manager", "cashier", "waiter"), async (req, res) => {
  const rid = restaurantId(req);
  const user = req.user!;
  const body = parse(orderInput, req.body);
  if (user.role === "waiter" && body.type !== "dine_in") throw new HttpError(403, "Waiters take table orders only");
  if (body.type === "delivery" && !body.customerAddress) throw new HttpError(400, "Enter the delivery address");

  let table: typeof diningTables.$inferSelect | undefined;
  if (body.type === "dine_in") {
    if (!body.tableId) throw new HttpError(400, "Pick a table");
    [table] = await db
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.id, body.tableId), eq(diningTables.restaurantId, rid), eq(diningTables.isActive, true)));
    if (!table) throw new HttpError(400, "That table doesn't exist");
  }

  const priced = await priceLines(rid, body.items);

  const result = await db.transaction(async (tx) => {
    // Serialise order numbering and table opening per restaurant.
    await tx.execute(sql`select pg_advisory_xact_lock(${rid})`);

    if (table) {
      const [open] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.tableId, table.id), notInArray(orders.status, [...CLOSED])))
        .limit(1);
      if (open) {
        const [{ lastRound } = { lastRound: 1 }] = await tx
          .select({ lastRound: max(orderItems.round) })
          .from(orderItems)
          .where(eq(orderItems.orderId, open.id));
        const added = await insertItems(tx, open, priced.lines, (lastRound ?? 1) + 1, user.id);
        const [updated] = await tx
          .update(orders)
          .set({
            subtotal: open.subtotal + priced.subtotal,
            total: open.subtotal + priced.subtotal - open.discount,
            notes: body.notes ?? open.notes,
          })
          .where(eq(orders.id, open.id))
          .returning();
        return { order: updated!, added, isNew: false };
      }
    }

    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${orders.orderNo}), 0)::int + 1` })
      .from(orders)
      .where(eq(orders.restaurantId, rid));
    const discount = table ? 0 : Math.min(body.discount, priced.subtotal);
    const [order] = await tx
      .insert(orders)
      .values({
        restaurantId: rid,
        orderNo: next,
        type: body.type,
        tableId: table?.id ?? null,
        tableNo: table?.name ?? null,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerAddress: body.customerAddress,
        notes: body.notes,
        subtotal: priced.subtotal,
        discount,
        total: priced.subtotal - discount,
        // Dine-in pays when the table settles; takeaway and delivery pay now.
        paymentMode: table ? null : body.paymentMode,
        createdBy: user.id,
      })
      .returning();
    const added = await insertItems(tx, order!, priced.lines, 1, user.id);
    return { order: order!, added, isNew: true };
  });

  await syncOrderStatus(result.order.id);
  const full = await loadOrder(rid, result.order.id);
  await publish(
    orderEvent(result.isNew ? "order.created" : "items.added", full, {
      itemIds: result.added.map((i) => i.id),
      categoryIds: categoriesOf(result.added),
      source: user.role,
    }),
  );
  res.status(201).json({
    ...full,
    addedItemIds: result.added.map((i) => i.id),
    noCookCategories: await categoriesWithoutCook(rid, categoriesOf(result.added)),
  });
});

const boardStatuses = ["placed", "cooking", "packing", "serving", "served", "completed", "cancelled"] as const;

ordersRouter.get("/orders", requireRole("owner", "manager", "cashier"), async (req, res) => {
  const rid = restaurantId(req);
  const q = parse(
    z.object({
      status: z.enum([...boardStatuses, "active"]).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    req.query,
  );
  const conds = [eq(orders.restaurantId, rid)];
  if (q.status === "active") conds.push(notInArray(orders.status, [...CLOSED]));
  else if (q.status) conds.push(eq(orders.status, q.status));
  if (q.date) {
    const from = new Date(`${q.date}T00:00:00`);
    conds.push(gte(orders.createdAt, from), lt(orders.createdAt, new Date(from.getTime() + 86_400_000)));
  }
  const rows = await db
    .select()
    .from(orders)
    .where(and(...conds))
    .orderBy(desc(orders.createdAt))
    .limit(200);
  res.json(await withItems(rows));
});

ordersRouter.get("/orders/:id", async (req, res) => {
  res.json(await loadOrder(restaurantId(req), idParam(req.params.id)));
});

ordersRouter.post("/orders/:id/cancel", requireRole("owner", "manager", "cashier"), async (req, res) => {
  const rid = restaurantId(req);
  const order = await loadOrder(rid, idParam(req.params.id));
  if (order.status === "completed") throw new HttpError(409, "A completed order can't be cancelled");
  const [updated] = await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id)).returning();
  await publish(orderEvent("order.updated", updated!, { categoryIds: categoriesOf(order.items) }));
  res.json(await loadOrder(rid, order.id));
});

// ---- Tables: what's at every table right now ----

ordersRouter.get("/tables/status", requireRole("owner", "manager", "cashier", "waiter"), async (req, res) => {
  const rid = restaurantId(req);
  const tables = await db
    .select()
    .from(diningTables)
    .where(and(eq(diningTables.restaurantId, rid), eq(diningTables.isActive, true)))
    .orderBy(asc(diningTables.sortOrder), asc(diningTables.id));
  const open = await withItems(
    await db
      .select()
      .from(orders)
      .where(and(eq(orders.restaurantId, rid), eq(orders.type, "dine_in"), notInArray(orders.status, [...CLOSED])))
      .orderBy(asc(orders.createdAt)),
  );
  res.json(tables.map((t) => ({ ...t, order: open.find((o) => o.tableId === t.id) ?? null })));
});

/** Waiter took food to the table. Marks ready (done) items as served; all of them if none are named. */
ordersRouter.post("/orders/:id/serve", requireRole("owner", "manager", "cashier", "waiter"), async (req, res) => {
  const rid = restaurantId(req);
  const { itemIds } = parse(z.object({ itemIds: z.array(z.number().int()).optional() }), req.body ?? {});
  const order = await loadOrder(rid, idParam(req.params.id));
  if (order.type !== "dine_in") throw new HttpError(400, "Only table orders are served by waiters");
  const ready = order.items.filter((i) => i.status === "done" && (!itemIds || itemIds.includes(i.id)));
  if (ready.length === 0) throw new HttpError(409, "Nothing is ready to serve yet");
  await db
    .update(orderItems)
    .set({ status: "served", servedAt: new Date() })
    .where(inArray(orderItems.id, ready.map((i) => i.id)));
  const changed = await syncOrderStatus(order.id);
  await publish(orderEvent(changed ? "order.updated" : "item.updated", changed ?? order));
  res.json(await loadOrder(rid, order.id));
});

/** Takes payment for a table and frees it. Food still in the kitchen must be finished (or the order cancelled) first. */
ordersRouter.post("/orders/:id/settle", requireRole("owner", "manager", "cashier"), async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(
    z.object({ paymentMode: z.enum(["cash", "upi", "card"]), discount: z.number().int().min(0).default(0) }),
    req.body,
  );
  const order = await loadOrder(rid, idParam(req.params.id));
  if (order.type !== "dine_in") throw new HttpError(400, "Only table orders are settled here");
  if (CLOSED.includes(order.status as (typeof CLOSED)[number])) throw new HttpError(409, "This table's bill is already closed");
  const cooking = order.items.filter((i) => i.status === "pending" || i.status === "cooking");
  if (cooking.length > 0) {
    throw new HttpError(409, `${cooking.map((i) => i.name).join(", ")} still in the kitchen. Wait for it, or cancel the order.`);
  }
  const discount = Math.min(body.discount, order.subtotal);
  const now = new Date();
  await db
    .update(orderItems)
    .set({ status: "served", servedAt: now })
    .where(and(eq(orderItems.orderId, order.id), eq(orderItems.status, "done")));
  const [updated] = await db
    .update(orders)
    .set({
      status: "completed",
      completedAt: now,
      paymentMode: body.paymentMode,
      discount,
      total: order.subtotal - discount,
    })
    .where(eq(orders.id, order.id))
    .returning();
  await publish(orderEvent("order.updated", updated!));
  res.json(await loadOrder(rid, order.id));
});

// ---- Kitchen: each cook sees only the foods in their categories, oldest bill first ----

/** Cooks get their own categories; owners and managers pick one category to view. */
function resolveCategories(req: { user?: { role: string; categoryIds: number[] } }, requested: unknown): number[] {
  const user = req.user!;
  if (user.role === "cook") {
    if (user.categoryIds.length === 0) throw new HttpError(400, "No food categories are assigned to you yet. Ask your manager.");
    return user.categoryIds;
  }
  if (!["owner", "manager"].includes(user.role)) throw new HttpError(403, "The kitchen screen is for cooks");
  const id = Number(requested);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Choose a category");
  return [id];
}

ordersRouter.get("/kitchen/queue", async (req, res) => {
  const rid = restaurantId(req);
  const categoryIds = resolveCategories(req, req.query.categoryId);
  const items = await db
    .select({ item: orderItems, order: orders })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.restaurantId, rid),
        inArray(orderItems.categoryId, categoryIds),
        inArray(orderItems.status, ["pending", "cooking"]),
        notInArray(orders.status, [...CLOSED]),
      ),
    )
    .orderBy(asc(orders.createdAt), asc(orderItems.id));

  const tickets = new Map<number, OrderRow & { items: ItemRow[] }>();
  for (const { item, order } of items) {
    if (!tickets.has(order.id)) tickets.set(order.id, { ...order, items: [] });
    tickets.get(order.id)!.items.push(item);
  }
  res.json([...tickets.values()]);
});

/** One food at a time: Start (pending → cooking), then Done (cooking → done). */
ordersRouter.patch("/kitchen/items/:id", async (req, res) => {
  const rid = restaurantId(req);
  const { status } = parse(z.object({ status: z.enum(["cooking", "done"]) }), req.body);
  const [item] = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, idParam(req.params.id)), eq(orderItems.restaurantId, rid)));
  if (!item || item.categoryId === null) throw notFound("Item");
  const categoryIds = resolveCategories(req, item.categoryId);
  if (!categoryIds.includes(item.categoryId)) throw new HttpError(403, "This food belongs to another cook's category");
  const allowedFrom = status === "cooking" ? "pending" : "cooking";
  if (item.status !== allowedFrom) {
    throw new HttpError(409, status === "done" ? "Tap Start before marking it done" : "This food is already started");
  }
  await db
    .update(orderItems)
    .set(status === "cooking" ? { status, startedAt: new Date(), cookedBy: req.user!.id } : { status, doneAt: new Date() })
    .where(eq(orderItems.id, item.id));
  const changed = await syncOrderStatus(item.orderId);
  const [order] = await db.select().from(orders).where(eq(orders.id, item.orderId));
  await publish(orderEvent(changed ? "order.updated" : "item.updated", order!, { categoryIds: [item.categoryId] }));
  res.status(204).end();
});

// ---- Packing: takeaway and delivery orders, once every cook is done ----

const packingRoles = requireRole("owner", "manager", "cashier", "packer");

ordersRouter.get("/packing/queue", packingRoles, async (req, res) => {
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId(req)),
        ne(orders.type, "dine_in"),
        inArray(orders.status, ["placed", "cooking", "packing"]),
      ),
    )
    .orderBy(asc(orders.createdAt));
  res.json(await withItems(rows));
});

ordersRouter.post("/packing/orders/:id/complete", packingRoles, async (req, res) => {
  const rid = restaurantId(req);
  const order = await loadOrder(rid, idParam(req.params.id));
  if (order.status !== "packing") throw new HttpError(409, "This order is still being cooked");
  const [updated] = await db
    .update(orders)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(orders.id, order.id))
    .returning();
  await publish(orderEvent("order.updated", updated!));
  res.json(await loadOrder(rid, order.id));
});

// ---- Reports ----

ordersRouter.get("/reports/summary", requireRole("owner", "manager"), async (req, res) => {
  const rid = restaurantId(req);
  const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
  const from = new Date(`${q.date}T00:00:00`);
  const to = new Date(from.getTime() + 86_400_000);
  const range = and(
    eq(orders.restaurantId, rid),
    gte(orders.createdAt, from),
    lt(orders.createdAt, to),
    ne(orders.status, "cancelled"),
  );

  const [totals] = await db
    .select({
      orders: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${orders.total}), 0)::int`,
      avgMinutes: sql<number | null>`round(avg(extract(epoch from (${orders.completedAt} - ${orders.createdAt})) / 60))::int`,
    })
    .from(orders)
    .where(range);
  const byType = await db
    .select({ type: orders.type, orders: sql<number>`count(*)::int`, revenue: sql<number>`sum(${orders.total})::int` })
    .from(orders)
    .where(range)
    .groupBy(orders.type);
  const byPayment = await db
    .select({ mode: orders.paymentMode, revenue: sql<number>`sum(${orders.total})::int` })
    .from(orders)
    .where(range)
    .groupBy(orders.paymentMode);
  const topItems = await db
    .select({
      name: orderItems.name,
      qty: sql<number>`sum(${orderItems.qty})::int`,
      revenue: sql<number>`sum(${orderItems.qty} * ${orderItems.price})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(range)
    .groupBy(orderItems.name)
    .orderBy(desc(sql`sum(${orderItems.qty})`))
    .limit(10);
  const byCategory = await db
    .select({
      categoryId: orderItems.categoryId,
      qty: sql<number>`sum(${orderItems.qty})::int`,
      avgCookMinutes: sql<number | null>`round(avg(extract(epoch from (${orderItems.doneAt} - ${orders.createdAt})) / 60))::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(range)
    .groupBy(orderItems.categoryId);

  const [spent] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)::int` })
    .from(expenses)
    .where(and(eq(expenses.restaurantId, rid), eq(expenses.spentOn, q.date)));

  res.json({ ...totals, expenses: spent?.total ?? 0, byType, byPayment, topItems, byCategory });
});
