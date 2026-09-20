import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  categories,
  db,
  diningTables,
  menuItems,
  plans,
  printers,
  restaurants,
  subscriptions,
  users,
} from "@workspace/db";
import { activeSubscription, requireRole, restaurantId } from "../lib/auth.js";
import { HttpError, idParam, notFound, parse } from "../lib/http.js";

/** Restaurant setup: profile, menu and categories, dining tables, printers and staff logins. */
export const setupRouter = Router();

const managers = requireRole("owner", "manager");

// ---- Everything the POS / admin needs in one request ----

setupRouter.get("/bootstrap", async (req, res) => {
  const rid = restaurantId(req);
  const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, rid));
  const sub = await activeSubscription(rid);
  const plan = sub ? (await db.select().from(plans).where(eq(plans.id, sub.planId)))[0] : null;
  res.json({
    restaurant,
    subscription: sub && { ...sub, planName: plan?.name ?? null, maxStaff: plan?.maxStaff ?? null },
    categories: await db.select().from(categories).where(eq(categories.restaurantId, rid)).orderBy(asc(categories.sortOrder), asc(categories.id)),
    menuItems: await db.select().from(menuItems).where(eq(menuItems.restaurantId, rid)).orderBy(asc(menuItems.name)),
    printers: await db.select().from(printers).where(eq(printers.restaurantId, rid)).orderBy(asc(printers.id)),
    tables: await db
      .select()
      .from(diningTables)
      .where(eq(diningTables.restaurantId, rid))
      .orderBy(asc(diningTables.sortOrder), asc(diningTables.id)),
  });
});

setupRouter.patch("/restaurant", requireRole("owner"), async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).optional(),
      phone: z.string().trim().nullish(),
      address: z.string().trim().nullish(),
      gstin: z.string().trim().nullish(),
    }),
    req.body,
  );
  const [r] = await db.update(restaurants).set(body).where(eq(restaurants.id, restaurantId(req))).returning();
  res.json(r);
});

/** Ensures every referenced category belongs to this restaurant. */
async function assertCategories(ids: number[] | null | undefined, rid: number) {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.restaurantId, rid), inArray(categories.id, unique)));
  if (rows.length !== unique.length) throw new HttpError(400, "A selected category doesn't exist");
}

// ---- Categories ----

const categoryInput = z.object({
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2a78d6").optional(),
  sortOrder: z.number().int().optional(),
});

setupRouter.post("/categories", managers, async (req, res) => {
  const [row] = await db
    .insert(categories)
    .values({ ...parse(categoryInput, req.body), restaurantId: restaurantId(req) })
    .returning();
  res.status(201).json(row);
});

setupRouter.patch("/categories/:id", managers, async (req, res) => {
  const [row] = await db
    .update(categories)
    .set(parse(categoryInput.partial(), req.body))
    .where(and(eq(categories.id, idParam(req.params.id)), eq(categories.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Category");
  res.json(row);
});

setupRouter.delete("/categories/:id", managers, async (req, res) => {
  const rid = restaurantId(req);
  const id = idParam(req.params.id);
  const row = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(categories)
      .where(and(eq(categories.id, id), eq(categories.restaurantId, rid)))
      .returning();
    // Take the category off every cook and kitchen printer that had it.
    await tx.update(users).set({ categoryIds: sql`array_remove(${users.categoryIds}, ${id})` }).where(eq(users.restaurantId, rid));
    await tx.update(printers).set({ categoryIds: sql`array_remove(${printers.categoryIds}, ${id})` }).where(eq(printers.restaurantId, rid));
    return deleted;
  });
  if (!row) throw notFound("Category");
  res.status(204).end();
});

// ---- Dining tables ----

const tableInput = z.object({
  name: z.string().trim().min(1),
  seats: z.number().int().min(1).max(50),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

setupRouter.post("/tables", managers, async (req, res) => {
  const [row] = await db
    .insert(diningTables)
    .values({ ...parse(tableInput, req.body), restaurantId: restaurantId(req) })
    .returning();
  res.status(201).json(row);
});

setupRouter.patch("/tables/:id", managers, async (req, res) => {
  const [row] = await db
    .update(diningTables)
    .set(parse(tableInput.partial(), req.body))
    .where(and(eq(diningTables.id, idParam(req.params.id)), eq(diningTables.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Table");
  res.json(row);
});

setupRouter.delete("/tables/:id", managers, async (req, res) => {
  const [row] = await db
    .delete(diningTables)
    .where(and(eq(diningTables.id, idParam(req.params.id)), eq(diningTables.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Table");
  res.status(204).end();
});

// ---- Menu items ----

const menuInput = z.object({
  name: z.string().trim().min(1),
  price: z.number().int().min(0),
  isVeg: z.boolean(),
  isAvailable: z.boolean(),
  categoryId: z.number({ error: "Pick a category" }).int(),
});

setupRouter.post("/menu-items", managers, async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(menuInput, req.body);
  await assertCategories([body.categoryId], rid);
  const [row] = await db.insert(menuItems).values({ ...body, restaurantId: rid }).returning();
  res.status(201).json(row);
});

/** Cashiers may toggle availability (item sold out); everything else needs a manager. */
setupRouter.patch("/menu-items/:id", async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(menuInput.partial(), req.body);
  const onlyAvailability = Object.keys(body).every((k) => k === "isAvailable");
  if (!onlyAvailability && !["owner", "manager"].includes(req.user!.role)) {
    throw new HttpError(403, "Only owners and managers can edit menu items");
  }
  await assertCategories(body.categoryId === undefined ? [] : [body.categoryId], rid);
  const [row] = await db
    .update(menuItems)
    .set(body)
    .where(and(eq(menuItems.id, idParam(req.params.id)), eq(menuItems.restaurantId, rid)))
    .returning();
  if (!row) throw notFound("Menu item");
  res.json(row);
});

setupRouter.delete("/menu-items/:id", managers, async (req, res) => {
  const [row] = await db
    .delete(menuItems)
    .where(and(eq(menuItems.id, idParam(req.params.id)), eq(menuItems.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Menu item");
  res.status(204).end();
});

// ---- Printers ----

const printerInput = z
  .object({
    name: z.string().trim().min(1),
    connection: z.enum(["usb", "network", "bluetooth"]),
    address: z.string().trim(),
    paperWidth: z.union([z.literal(58), z.literal(80)]),
    purpose: z.enum(["kot", "bill"]),
    categoryIds: z.array(z.number().int()),
    isActive: z.boolean().optional(),
  });

setupRouter.post("/printers", managers, async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(printerInput, req.body);
  await assertCategories(body.categoryIds, rid);
  const [row] = await db
    .insert(printers)
    .values({ ...body, categoryIds: body.purpose === "kot" ? body.categoryIds : [], restaurantId: rid })
    .returning();
  res.status(201).json(row);
});

setupRouter.patch("/printers/:id", managers, async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(printerInput.partial(), req.body);
  await assertCategories(body.categoryIds, rid);
  const [row] = await db
    .update(printers)
    .set(body.purpose === "bill" ? { ...body, categoryIds: [] } : body)
    .where(and(eq(printers.id, idParam(req.params.id)), eq(printers.restaurantId, rid)))
    .returning();
  if (!row) throw notFound("Printer");
  res.json(row);
});

setupRouter.delete("/printers/:id", managers, async (req, res) => {
  const [row] = await db
    .delete(printers)
    .where(and(eq(printers.id, idParam(req.params.id)), eq(printers.restaurantId, restaurantId(req))))
    .returning();
  if (!row) throw notFound("Printer");
  res.status(204).end();
});

// ---- Staff logins ----

const staffColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  categoryIds: users.categoryIds,
  isActive: users.isActive,
};

const staffInput = z.object({
  name: z.string().trim().min(1),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(6, "Use at least 6 characters"),
  role: z.enum(["manager", "cashier", "waiter", "cook", "packer"]),
  categoryIds: z.array(z.number().int()),
  isActive: z.boolean().optional(),
});

function checkStaffRole(req: { user?: { role: string } }, role: string | undefined) {
  if (role === "manager" && req.user?.role !== "owner") {
    throw new HttpError(403, "Only the owner can add or change managers");
  }
}

function checkCookCategories(role: string | undefined, categoryIds: number[] | undefined) {
  if (role === "cook" && !categoryIds?.length) throw new HttpError(400, "Pick the food categories this cook makes");
}

setupRouter.get("/staff", managers, async (req, res) => {
  res.json(
    await db
      .select(staffColumns)
      .from(users)
      .where(eq(users.restaurantId, restaurantId(req)))
      .orderBy(asc(users.role), asc(users.name)),
  );
});

setupRouter.post("/staff", managers, async (req, res) => {
  const rid = restaurantId(req);
  const body = parse(staffInput, req.body);
  checkStaffRole(req, body.role);
  checkCookCategories(body.role, body.categoryIds);
  await assertCategories(body.categoryIds, rid);

  const sub = await activeSubscription(rid);
  const [plan] = sub ? await db.select().from(plans).where(eq(plans.id, sub.planId)) : [];
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.restaurantId, rid), ne(users.role, "owner"), eq(users.isActive, true)));
  if (plan && n >= plan.maxStaff) {
    throw new HttpError(402, `Your ${plan.name} plan allows ${plan.maxStaff} staff logins. Upgrade to add more.`);
  }

  const { password, ...rest } = body;
  const [row] = await db
    .insert(users)
    .values({
      ...rest,
      categoryIds: body.role === "cook" ? [...new Set(body.categoryIds)] : [],
      restaurantId: rid,
      passwordHash: await bcrypt.hash(password, 10),
    })
    .returning(staffColumns);
  res.status(201).json(row);
});

setupRouter.patch("/staff/:id", managers, async (req, res) => {
  const rid = restaurantId(req);
  const id = idParam(req.params.id);
  const body = parse(staffInput.partial(), req.body);
  const [existing] = await db.select().from(users).where(and(eq(users.id, id), eq(users.restaurantId, rid)));
  if (!existing) throw notFound("Staff member");
  if (existing.role === "owner") throw new HttpError(403, "The owner account can't be edited here");
  checkStaffRole(req, existing.role);
  checkStaffRole(req, body.role);
  const role = body.role ?? existing.role;
  const categoryIds = body.categoryIds ?? existing.categoryIds;
  checkCookCategories(role, categoryIds);
  await assertCategories(body.categoryIds, rid);

  const { password, ...rest } = body;
  const [row] = await db
    .update(users)
    .set({
      ...rest,
      categoryIds: role === "cook" ? [...new Set(categoryIds)] : [],
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    })
    .where(eq(users.id, id))
    .returning(staffColumns);
  res.json(row);
});

// Subscription history for the owner (read-only).
setupRouter.get("/subscription", requireRole("owner"), async (req, res) => {
  const rows = await db
    .select({ sub: subscriptions, planName: plans.name })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.restaurantId, restaurantId(req)))
    .orderBy(asc(subscriptions.startsAt));
  res.json(rows.map((r) => ({ ...r.sub, planName: r.planName })));
});
