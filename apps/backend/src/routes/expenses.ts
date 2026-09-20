import { Router } from "express";
import { and, asc, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, expenses, expenseTags, orders, users } from "@workspace/db";
import { requireRole, restaurantId } from "../lib/auth.js";
import { HttpError, idParam, notFound, parse } from "../lib/http.js";

/** Expense tracker: restaurant-defined tags and the expenses filed under them. */
export const expensesRouter = Router();

const managers = requireRole("owner", "manager");
const recorders = requireRole("owner", "manager", "cashier");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-19");

// ---- Tags ----

const tagInput = z.object({
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2F7D4E"),
});

expensesRouter.get("/expense-tags", recorders, async (req, res) => {
  res.json(
    await db.select().from(expenseTags).where(eq(expenseTags.restaurantId, restaurantId(req))).orderBy(asc(expenseTags.name)),
  );
});

expensesRouter.post("/expense-tags", recorders, async (req, res) => {
  const [row] = await db
    .insert(expenseTags)
    .values({ ...parse(tagInput, req.body), restaurantId: restaurantId(req) })
    .returning();
  res.status(201).json(row);
});

expensesRouter.patch("/expense-tags/:id", managers, async (req, res) => {
  const [row] = await db
    .update(expenseTags)
    .set(parse(tagInput.partial(), req.body))
    .where(and(eq(expenseTags.id, idParam(req.params.id)), eq(expenseTags.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Tag");
  res.json(row);
});

expensesRouter.delete("/expense-tags/:id", managers, async (req, res) => {
  const [row] = await db
    .delete(expenseTags)
    .where(and(eq(expenseTags.id, idParam(req.params.id)), eq(expenseTags.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Tag");
  res.status(204).end();
});

// ---- Expenses ----

const expenseInput = z.object({
  tagId: z.number().int().nullable(),
  amount: z.number().int().min(1, "Enter an amount"),
  spentOn: isoDate,
  vendor: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  paymentMode: z.enum(["cash", "upi", "card", "bank"]).nullish(),
});

async function assertTag(rid: number, tagId: number | null | undefined) {
  if (tagId == null) return;
  const [tag] = await db
    .select({ id: expenseTags.id })
    .from(expenseTags)
    .where(and(eq(expenseTags.id, tagId), eq(expenseTags.restaurantId, rid)));
  if (!tag) throw new HttpError(400, "That tag doesn't exist");
}

const rangeQuery = z.object({ from: isoDate, to: isoDate, tagId: z.coerce.number().int().optional() });

expensesRouter.get("/expenses", recorders, async (req, res) => {
  const rid = restaurantId(req);
  const q = parse(rangeQuery, req.query);
  const conds = [eq(expenses.restaurantId, rid), gte(expenses.spentOn, q.from), lte(expenses.spentOn, q.to)];
  if (q.tagId) conds.push(eq(expenses.tagId, q.tagId));
  const rows = await db
    .select({ expense: expenses, addedBy: users.name })
    .from(expenses)
    .leftJoin(users, eq(users.id, expenses.createdBy))
    .where(and(...conds))
    .orderBy(desc(expenses.spentOn), desc(expenses.id))
    .limit(500);
  res.json(rows.map((r) => ({ ...r.expense, addedBy: r.addedBy })));
});

expensesRouter.post("/expenses", recorders, async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(expenseInput, req.body);
  await assertTag(rid, body.tagId);
  const [row] = await db
    .insert(expenses)
    .values({ ...body, restaurantId: rid, createdBy: req.user!.id })
    .returning();
  res.status(201).json(row);
});

expensesRouter.patch("/expenses/:id", managers, async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(expenseInput.partial(), req.body);
  await assertTag(rid, body.tagId);
  const [row] = await db
    .update(expenses)
    .set(body)
    .where(and(eq(expenses.id, idParam(req.params.id)), eq(expenses.restaurantId, rid)))
    .returning();
  if (!row) throw notFound("Expense");
  res.json(row);
});

expensesRouter.delete("/expenses/:id", managers, async (req, res) => {
  const [row] = await db
    .delete(expenses)
    .where(and(eq(expenses.id, idParam(req.params.id)), eq(expenses.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Expense");
  res.status(204).end();
});

/** Spend per tag and per day for a date range, against sales for the same range. */
expensesRouter.get("/expenses/summary", managers, async (req, res) => {
  const rid = restaurantId(req);
  const q = parse(rangeQuery.omit({ tagId: true }), req.query);
  const range = and(eq(expenses.restaurantId, rid), gte(expenses.spentOn, q.from), lte(expenses.spentOn, q.to));

  const byTag = await db
    .select({
      tagId: expenses.tagId,
      total: sql<number>`sum(${expenses.amount})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(range)
    .groupBy(expenses.tagId)
    .orderBy(desc(sql`sum(${expenses.amount})`));
  const byDay = await db
    .select({ day: expenses.spentOn, total: sql<number>`sum(${expenses.amount})::int` })
    .from(expenses)
    .where(range)
    .groupBy(expenses.spentOn)
    .orderBy(asc(expenses.spentOn));

  // Sales use the restaurant's local day boundaries (server runs in the restaurant's TZ).
  const from = new Date(`${q.from}T00:00:00`);
  const to = new Date(new Date(`${q.to}T00:00:00`).getTime() + 86_400_000);
  const [sales] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.total}), 0)::int` })
    .from(orders)
    .where(and(eq(orders.restaurantId, rid), ne(orders.status, "cancelled"), gte(orders.createdAt, from), lt(orders.createdAt, to)));

  const total = byTag.reduce((s, t) => s + t.total, 0);
  const salesTotal = sales?.total ?? 0;
  res.json({ total, sales: salesTotal, net: salesTotal - total, byTag, byDay });
});
