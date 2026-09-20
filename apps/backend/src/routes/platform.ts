import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, plans, restaurants, subscriptions, users } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth.js";
import { idParam, notFound, parse } from "../lib/http.js";

/** Platform owner (super admin): plans, restaurants and their subscriptions. */
export const platformRouter = Router();
platformRouter.use(requireAuth, requireRole("super_admin"));

const planInput = z.object({
  name: z.string().trim().min(1),
  price: z.number().int().min(0),
  durationDays: z.number().int().min(1),
  maxStaff: z.number().int().min(1),
  isActive: z.boolean().optional(),
});

platformRouter.get("/plans", async (_req, res) => {
  res.json(await db.select().from(plans).orderBy(plans.price));
});

platformRouter.post("/plans", async (req, res) => {
  const [plan] = await db.insert(plans).values(parse(planInput, req.body)).returning();
  res.status(201).json(plan);
});

platformRouter.patch("/plans/:id", async (req, res) => {
  const [plan] = await db
    .update(plans)
    .set(parse(planInput.partial(), req.body))
    .where(eq(plans.id, idParam(req.params.id)))
    .returning();
  if (!plan) throw notFound("Plan");
  res.json(plan);
});

/** Latest subscription per restaurant, joined with plan name. */
async function latestSubscriptions() {
  const rows = await db
    .select({ sub: subscriptions, planName: plans.name })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .orderBy(desc(subscriptions.endsAt));
  const byRestaurant = new Map<number, (typeof rows)[number]["sub"] & { planName: string }>();
  for (const r of rows) {
    if (!byRestaurant.has(r.sub.restaurantId)) byRestaurant.set(r.sub.restaurantId, { ...r.sub, planName: r.planName });
  }
  return byRestaurant;
}

platformRouter.get("/restaurants", async (_req, res) => {
  const list = await db.select().from(restaurants).orderBy(desc(restaurants.createdAt));
  const owners = await db.select().from(users).where(eq(users.role, "owner"));
  const subs = await latestSubscriptions();
  res.json(
    list.map((r) => {
      const owner = owners.find((o) => o.restaurantId === r.id);
      const sub = subs.get(r.id) ?? null;
      const expired = sub && (sub.status !== "active" || sub.endsAt <= new Date());
      return {
        ...r,
        ownerEmail: owner?.email ?? null,
        ownerName: owner?.name ?? null,
        subscription: sub && { ...sub, status: expired && sub.status === "active" ? "expired" : sub.status },
      };
    }),
  );
});

const restaurantInput = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().nullish(),
  address: z.string().trim().nullish(),
  gstin: z.string().trim().nullish(),
});

platformRouter.post("/restaurants", async (req, res) => {
  const body = parse(
    restaurantInput.extend({
      planId: z.number().int(),
      owner: z.object({
        name: z.string().trim().min(1),
        email: z.email().trim().toLowerCase(),
        password: z.string().min(6, "Use at least 6 characters"),
      }),
    }),
    req.body,
  );
  const [plan] = await db.select().from(plans).where(eq(plans.id, body.planId));
  if (!plan) throw notFound("Plan");
  const passwordHash = await bcrypt.hash(body.owner.password, 10);

  const restaurant = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(restaurants)
      .values({ name: body.name, phone: body.phone, address: body.address, gstin: body.gstin })
      .returning();
    await tx.insert(users).values({
      email: body.owner.email,
      name: body.owner.name,
      role: "owner",
      restaurantId: r!.id,
      passwordHash,
    });
    const now = new Date();
    await tx.insert(subscriptions).values({
      restaurantId: r!.id,
      planId: plan.id,
      startsAt: now,
      endsAt: new Date(now.getTime() + plan.durationDays * 86_400_000),
      amount: plan.price,
    });
    return r!;
  });
  res.status(201).json(restaurant);
});

platformRouter.patch("/restaurants/:id", async (req, res) => {
  const body = parse(restaurantInput.partial().extend({ isActive: z.boolean().optional() }), req.body);
  const [r] = await db.update(restaurants).set(body).where(eq(restaurants.id, idParam(req.params.id))).returning();
  if (!r) throw notFound("Restaurant");
  res.json(r);
});

platformRouter.post("/restaurants/:id/owner-password", async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(6, "Use at least 6 characters") }), req.body);
  const updated = await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(password, 10) })
    .where(and(eq(users.restaurantId, idParam(req.params.id)), eq(users.role, "owner")))
    .returning({ id: users.id });
  if (updated.length === 0) throw notFound("Owner");
  res.status(204).end();
});

platformRouter.get("/restaurants/:id/subscriptions", async (req, res) => {
  const rows = await db
    .select({ sub: subscriptions, planName: plans.name })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.restaurantId, idParam(req.params.id)))
    .orderBy(desc(subscriptions.startsAt));
  res.json(rows.map((r) => ({ ...r.sub, planName: r.planName })));
});

/** Renew: the new period starts when the current one ends (or now, if it already lapsed). */
platformRouter.post("/restaurants/:id/subscriptions", async (req, res) => {
  const restaurantId = idParam(req.params.id);
  const body = parse(z.object({ planId: z.number().int(), amount: z.number().int().min(0).optional() }), req.body);
  const [plan] = await db.select().from(plans).where(eq(plans.id, body.planId));
  if (!plan) throw notFound("Plan");
  const [current] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.restaurantId, restaurantId),
        eq(subscriptions.status, "active"),
        gt(subscriptions.endsAt, new Date()),
      ),
    )
    .orderBy(desc(subscriptions.endsAt))
    .limit(1);
  const startsAt = current?.endsAt ?? new Date();
  const [sub] = await db
    .insert(subscriptions)
    .values({
      restaurantId,
      planId: plan.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + plan.durationDays * 86_400_000),
      amount: body.amount ?? plan.price,
    })
    .returning();
  res.status(201).json(sub);
});

platformRouter.post("/subscriptions/:id/cancel", async (req, res) => {
  const [sub] = await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(eq(subscriptions.id, idParam(req.params.id)))
    .returning();
  if (!sub) throw notFound("Subscription");
  res.json(sub);
});

platformRouter.get("/stats", async (_req, res) => {
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(restaurants);
  const subs = await latestSubscriptions();
  const now = Date.now();
  const soon = now + 7 * 86_400_000;
  let active = 0;
  let expiringSoon = 0;
  for (const s of subs.values()) {
    const end = s.endsAt.getTime();
    if (s.status === "active" && end > now) {
      active++;
      if (end < soon) expiringSoon++;
    }
  }
  const [{ revenue } = { revenue: 0 }] = await db
    .select({ revenue: sql<number>`coalesce(sum(${subscriptions.amount}), 0)::int` })
    .from(subscriptions)
    .where(sql`${subscriptions.status} <> 'cancelled'`);
  res.json({ restaurants: total, active, expired: total - active, expiringSoon, revenue });
});
