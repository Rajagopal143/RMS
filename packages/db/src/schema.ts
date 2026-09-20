import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["super_admin", "owner", "manager", "cashier", "cook", "packer", "waiter"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "expired", "cancelled"]);
export const orderTypeEnum = pgEnum("order_type", ["dine_in", "takeaway", "delivery"]);
/**
 * placed/cooking: in the kitchen · packing: takeaway/delivery ready to pack ·
 * serving: dine-in food ready for the waiter · served: everything at the table, awaiting the bill.
 */
export const orderStatusEnum = pgEnum("order_status", ["placed", "cooking", "packing", "serving", "served", "completed", "cancelled"]);
export const itemStatusEnum = pgEnum("item_status", ["pending", "cooking", "done", "served"]);
export const printerConnectionEnum = pgEnum("printer_connection", ["usb", "network", "bluetooth"]);
export const printerPurposeEnum = pgEnum("printer_purpose", ["kot", "bill"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ---- Platform: plans, restaurants, subscriptions ----

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** Price per billing period, in paise. */
  price: integer("price").notNull(),
  durationDays: integer("duration_days").notNull(),
  maxStaff: integer("max_staff").notNull().default(10),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const restaurants = pgTable("restaurants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  gstin: text("gstin"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => plans.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    amount: integer("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("subscriptions_restaurant_idx").on(t.restaurantId)],
);

// ---- Restaurant setup: menu categories, printers, staff ----

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id, { onDelete: "cascade" }),
  /** For cooks: the food categories they cook. Orders show them only these foods. */
  categoryIds: integer("category_ids").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** Food category. Doubles as the kitchen routing tag: cooks see only their categories' foods. */
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#2a78d6"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** In paise. */
    price: integer("price").notNull(),
    isVeg: boolean("is_veg").notNull().default(true),
    isAvailable: boolean("is_available").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("menu_items_restaurant_idx").on(t.restaurantId)],
);

export const printers = pgTable("printers", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  connection: printerConnectionEnum("connection").notNull(),
  /** usb: OS printer name · network: ip[:port] · bluetooth: serial port path or OS printer name */
  address: text("address").notNull(),
  paperWidth: integer("paper_width").notNull().default(80),
  purpose: printerPurposeEnum("purpose").notNull(),
  /** For KOT printers: the food categories whose items it prints. */
  categoryIds: integer("category_ids").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** Dining tables, added by the owner or manager. Waiters take orders against them. */
export const diningTables = pgTable(
  "dining_tables",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    seats: integer("seats").notNull().default(4),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dining_tables_restaurant_name_idx").on(t.restaurantId, t.name)],
);

// ---- Orders ----

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    orderNo: integer("order_no").notNull(),
    type: orderTypeEnum("type").notNull(),
    status: orderStatusEnum("status").notNull().default("placed"),
    tableId: integer("table_id").references(() => diningTables.id, { onDelete: "set null" }),
    /** Table name at the time of the order, for bills and history. */
    tableNo: text("table_no"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerAddress: text("customer_address"),
    notes: text("notes"),
    subtotal: integer("subtotal").notNull(),
    /** No longer charged; kept for bills made before tax was removed. */
    tax: integer("tax").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull(),
    paymentMode: text("payment_mode"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    cookedAt: timestamp("cooked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("orders_restaurant_no_idx").on(t.restaurantId, t.orderNo),
    index("orders_restaurant_status_idx").on(t.restaurantId, t.status),
    index("orders_table_idx").on(t.tableId),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").references(() => menuItems.id, { onDelete: "set null" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    qty: integer("qty").notNull(),
    notes: text("notes"),
    status: itemStatusEnum("status").notNull().default("pending"),
    /** 1 for the first send to the kitchen; later additions to a table's order get 2, 3, … */
    round: integer("round").notNull().default(1),
    addedBy: integer("added_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    cookedBy: integer("cooked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_category_status_idx").on(t.categoryId, t.status),
  ],
);

// ---- Expenses ----

/** Restaurant-defined expense tag, e.g. "Vegetables", "Gas", "Salary". */
export const expenseTags = pgTable(
  "expense_tags",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6B7178"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("expense_tags_restaurant_name_idx").on(t.restaurantId, t.name)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    tagId: integer("tag_id").references(() => expenseTags.id, { onDelete: "set null" }),
    /** In paise. */
    amount: integer("amount").notNull(),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    vendor: text("vendor"),
    note: text("note"),
    paymentMode: text("payment_mode"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_restaurant_date_idx").on(t.restaurantId, t.spentOn)],
);
