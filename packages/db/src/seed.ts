/**
 * Idempotent seed: platform admin + default plans, and (with SEED_DEMO=true) a demo restaurant.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { client, db } from "./index.js";
import {
  categories,
  diningTables,
  expenses,
  expenseTags,
  menuItems,
  plans,
  printers,
  restaurants,
  subscriptions,
  users,
} from "./schema.js";

const hash = (p: string) => bcrypt.hash(p, 10);

async function seedPlatform() {
  const email = process.env.SUPERADMIN_EMAIL ?? "admin@rms.local";
  const password = process.env.SUPERADMIN_PASSWORD ?? "admin123";
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length === 0) {
    await db.insert(users).values({
      email,
      name: "Platform Admin",
      role: "super_admin",
      passwordHash: await hash(password),
    });
    console.log(`Created platform admin ${email}`);
  }

  if ((await db.select().from(plans)).length === 0) {
    await db.insert(plans).values([
      { name: "Starter", price: 99900, durationDays: 30, maxStaff: 5 },
      { name: "Growth", price: 249900, durationDays: 30, maxStaff: 20 },
      { name: "Yearly", price: 2499900, durationDays: 365, maxStaff: 50 },
    ]);
    console.log("Created default plans");
  }
}

async function seedDemo() {
  const ownerEmail = "owner@demo.local";
  if ((await db.select().from(users).where(eq(users.email, ownerEmail))).length > 0) return;

  const [plan] = await db.select().from(plans).limit(1);
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: "Spice Route Kitchen", phone: "98765 43210", address: "12 MG Road, Chennai", gstin: "33ABCDE1234F1Z5" })
    .returning();
  const rid = restaurant!.id;
  const now = new Date();
  await db.insert(subscriptions).values({
    restaurantId: rid,
    planId: plan!.id,
    startsAt: now,
    endsAt: new Date(now.getTime() + plan!.durationDays * 86400000),
    amount: plan!.price,
  });

  const [mains, starters, bev] = await db
    .insert(categories)
    .values([
      { restaurantId: rid, name: "Rice & Noodles", color: "#eb6834", sortOrder: 1 },
      { restaurantId: rid, name: "Tandoor", color: "#eda100", sortOrder: 2 },
      { restaurantId: rid, name: "Drinks", color: "#2a78d6", sortOrder: 3 },
    ])
    .returning();

  await db.insert(menuItems).values([
    { restaurantId: rid, categoryId: mains!.id, name: "Veg Fried Rice", price: 18000 },
    { restaurantId: rid, categoryId: mains!.id, name: "Chicken Fried Rice", price: 22000, isVeg: false },
    { restaurantId: rid, categoryId: mains!.id, name: "Hakka Noodles", price: 19000 },
    { restaurantId: rid, categoryId: mains!.id, name: "Schezwan Noodles", price: 20000 },
    { restaurantId: rid, categoryId: starters!.id, name: "Paneer Tikka", price: 26000 },
    { restaurantId: rid, categoryId: starters!.id, name: "Tandoori Chicken (Half)", price: 32000, isVeg: false },
    { restaurantId: rid, categoryId: starters!.id, name: "Butter Naan", price: 6000 },
    { restaurantId: rid, categoryId: bev!.id, name: "Fresh Lime Soda", price: 9000 },
    { restaurantId: rid, categoryId: bev!.id, name: "Masala Chaas", price: 7000 },
  ]);

  const pw = await hash("demo123");
  await db.insert(users).values([
    { email: ownerEmail, name: "Arun (Owner)", role: "owner", restaurantId: rid, passwordHash: pw },
    { email: "cashier@demo.local", name: "Priya", role: "cashier", restaurantId: rid, passwordHash: pw },
    { email: "chinese@demo.local", name: "Wei (Chinese)", role: "cook", restaurantId: rid, categoryIds: [mains!.id], passwordHash: pw },
    { email: "tandoor@demo.local", name: "Ravi (Tandoor)", role: "cook", restaurantId: rid, categoryIds: [starters!.id], passwordHash: pw },
    { email: "drinks@demo.local", name: "Meena (Beverages)", role: "cook", restaurantId: rid, categoryIds: [bev!.id], passwordHash: pw },
    { email: "packing@demo.local", name: "Karthik (Packing)", role: "packer", restaurantId: rid, passwordHash: pw },
  ]);

  await db.insert(printers).values([
    { restaurantId: rid, name: "Counter", connection: "usb", address: "", purpose: "bill", paperWidth: 80 },
  ]);
  console.log(`Created demo restaurant "${restaurant!.name}" (logins: *@demo.local / demo123)`);
}

/** Demo expense tags and a week of expenses, added once. */
async function seedDemoExpenses() {
  const [owner] = await db.select().from(users).where(eq(users.email, "owner@demo.local"));
  if (!owner?.restaurantId) return;
  const rid = owner.restaurantId;
  if ((await db.select().from(expenseTags).where(eq(expenseTags.restaurantId, rid))).length > 0) return;

  const tags = await db
    .insert(expenseTags)
    .values([
      { restaurantId: rid, name: "Vegetables", color: "#2a78d6" },
      { restaurantId: rid, name: "Meat & Fish", color: "#eb6834" },
      { restaurantId: rid, name: "Gas", color: "#1baf7a" },
      { restaurantId: rid, name: "Salary", color: "#eda100" },
      { restaurantId: rid, name: "Rent", color: "#e87ba4" },
      { restaurantId: rid, name: "Maintenance", color: "#008300" },
    ])
    .returning();
  const tag = (name: string) => tags.find((t) => t.name === name)!.id;
  const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
  await db.insert(expenses).values([
    { restaurantId: rid, tagId: tag("Vegetables"), amount: 185000, spentOn: day(0), vendor: "Koyambedu market", paymentMode: "cash", createdBy: owner.id },
    { restaurantId: rid, tagId: tag("Meat & Fish"), amount: 420000, spentOn: day(1), vendor: "Fresh Meats", paymentMode: "upi", createdBy: owner.id },
    { restaurantId: rid, tagId: tag("Gas"), amount: 190000, spentOn: day(2), vendor: "Indane", note: "2 commercial cylinders", paymentMode: "upi", createdBy: owner.id },
    { restaurantId: rid, tagId: tag("Vegetables"), amount: 162000, spentOn: day(3), vendor: "Koyambedu market", paymentMode: "cash", createdBy: owner.id },
    { restaurantId: rid, tagId: tag("Maintenance"), amount: 75000, spentOn: day(4), note: "Exhaust fan repair", paymentMode: "cash", createdBy: owner.id },
    { restaurantId: rid, tagId: tag("Rent"), amount: 4500000, spentOn: day(5), note: "Monthly rent", paymentMode: "bank", createdBy: owner.id },
  ]);
  console.log("Created demo expenses");
}

/** Demo dining tables and a waiter login, added once. */
async function seedDemoFloor() {
  const [owner] = await db.select().from(users).where(eq(users.email, "owner@demo.local"));
  if (!owner?.restaurantId) return;
  const rid = owner.restaurantId;
  if ((await db.select().from(diningTables).where(eq(diningTables.restaurantId, rid))).length === 0) {
    await db.insert(diningTables).values(
      Array.from({ length: 8 }, (_, i) => ({ restaurantId: rid, name: `T${i + 1}`, seats: i < 4 ? 2 : 4, sortOrder: i + 1 })),
    );
    console.log("Created demo tables T1–T8");
  }
  if ((await db.select().from(users).where(eq(users.email, "waiter@demo.local"))).length === 0) {
    await db.insert(users).values({
      email: "waiter@demo.local",
      name: "Suresh (Waiter)",
      role: "waiter",
      restaurantId: rid,
      passwordHash: await hash("demo123"),
    });
    console.log("Created demo waiter waiter@demo.local");
  }
}

try {
  await seedPlatform();
  if (process.env.SEED_DEMO === "true") {
    await seedDemo();
    await seedDemoExpenses();
    await seedDemoFloor();
  }
} finally {
  await client.end();
}
