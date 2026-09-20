export const ROLES = ["super_admin", "owner", "manager", "cashier", "cook", "packer", "waiter"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ["manager", "cashier", "waiter", "cook", "packer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ORDER_TYPES = ["dine_in", "takeaway", "delivery"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/**
 * placed/cooking: in the kitchen · packing: takeaway/delivery ready to pack ·
 * serving: dine-in food ready for the waiter · served: all food at the table, awaiting the bill.
 */
export type OrderStatus = "placed" | "cooking" | "packing" | "serving" | "served" | "completed" | "cancelled";
export type ItemStatus = "pending" | "cooking" | "done" | "served";

export const PRINTER_CONNECTIONS = ["usb", "network", "bluetooth"] as const;
export type PrinterConnection = (typeof PRINTER_CONNECTIONS)[number];
export type PrinterPurpose = "kot" | "bill";

export const PAYMENT_MODES = ["cash", "upi", "card"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  restaurantId: number | null;
  /** For cooks: the food categories they cook. */
  categoryIds: number[];
  restaurant?: Restaurant | null;
}

export interface Plan {
  id: number;
  name: string;
  price: number;
  durationDays: number;
  maxStaff: number;
  isActive: boolean;
}

export interface Subscription {
  id: number;
  restaurantId: number;
  planId: number;
  planName?: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "expired" | "cancelled";
  amount: number;
}

export interface Restaurant {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RestaurantSummary extends Restaurant {
  ownerEmail: string | null;
  ownerName: string | null;
  subscription: Subscription | null;
}

/** Food category; also decides which cooks see a food on their kitchen screen. */
export interface Category {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
}

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  isVeg: boolean;
  isAvailable: boolean;
  categoryId: number | null;
}

export interface DiningTable {
  id: number;
  name: string;
  seats: number;
  sortOrder: number;
  isActive: boolean;
}

/** A table with its open order, if anyone is sitting there. */
export interface TableStatus extends DiningTable {
  order: Order | null;
}

export interface Printer {
  id: number;
  name: string;
  connection: PrinterConnection;
  address: string;
  paperWidth: 58 | 80;
  purpose: PrinterPurpose;
  /** For KOT printers: the categories whose foods it prints. */
  categoryIds: number[];
  isActive: boolean;
}

export interface StaffMember {
  id: number;
  name: string;
  email: string;
  role: Role;
  categoryIds: number[];
  isActive: boolean;
}

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number | null;
  categoryId: number | null;
  name: string;
  price: number;
  qty: number;
  notes: string | null;
  status: ItemStatus;
  round: number;
  startedAt: string | null;
  doneAt: string | null;
  servedAt: string | null;
}

export interface Order {
  id: number;
  orderNo: number;
  type: OrderType;
  status: OrderStatus;
  tableId: number | null;
  tableNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  notes: string | null;
  subtotal: number;
  /** Always 0 now; older bills may still carry tax. */
  tax: number;
  discount: number;
  total: number;
  paymentMode: PaymentMode | null;
  createdAt: string;
  completedAt: string | null;
  items: OrderItem[];
}

/** Real-time event pushed over the WebSocket. Clients refetch what they show. */
export interface RealtimeEvent {
  type: "order.created" | "items.added" | "order.updated" | "item.updated";
  restaurantId: number;
  orderId: number;
  orderNo?: number;
  orderType?: OrderType;
  status?: OrderStatus;
  tableName?: string | null;
  /** Items just sent to the kitchen (order.created / items.added). */
  itemIds?: number[];
  /** Role of whoever caused the event, e.g. "waiter". */
  source?: Role;
  categoryIds?: number[];
}

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Platform admin",
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  cook: "Cook",
  packer: "Packing",
  waiter: "Waiter",
};

/** Money is stored in paise. */
export function formatMoney(paise: number, symbol = "₹"): string {
  return `${symbol}${(paise / 100).toFixed(2)}`;
}

export const EXPENSE_PAYMENT_MODES = ["cash", "upi", "card", "bank"] as const;
export type ExpensePaymentMode = (typeof EXPENSE_PAYMENT_MODES)[number];

/**
 * Tag colours, in fixed order: a new tag takes the next slot.
 * Validated for colour-blind separation (dataviz palette check).
 */
export const TAG_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"] as const;

export interface ExpenseTag {
  id: number;
  name: string;
  color: string;
}

export interface Expense {
  id: number;
  tagId: number | null;
  amount: number;
  spentOn: string;
  vendor: string | null;
  note: string | null;
  paymentMode: ExpensePaymentMode | null;
  addedBy?: string | null;
  createdAt: string;
}

export interface ExpenseSummary {
  total: number;
  sales: number;
  net: number;
  byTag: { tagId: number | null; total: number; count: number }[];
  byDay: { day: string; total: number }[];
}
