import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, restaurants, subscriptions, users } from "@workspace/db";
import { HttpError } from "./http.js";

export type Role = (typeof users.$inferSelect)["role"];

export interface AuthUser {
  id: number;
  role: Role;
  restaurantId: number | null;
  categoryIds: number[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
if (!process.env.JWT_SECRET) console.warn("JWT_SECRET not set; using the insecure dev default");

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: "7d" });
}

/** Current subscription for a restaurant, if it is active and not past its end date. */
export async function activeSubscription(restaurantId: number) {
  const [sub] = await db
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
  return sub ?? null;
}

/** Throws if a restaurant user may not use the app (restaurant disabled or subscription lapsed). */
export async function assertRestaurantAccess(restaurantId: number): Promise<void> {
  const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId));
  if (!restaurant?.isActive) throw new HttpError(403, "This restaurant has been disabled. Contact support.");
  if (!(await activeSubscription(restaurantId))) {
    throw new HttpError(402, "Your subscription has expired. Renew it to continue.");
  }
}

/** Verifies the bearer token and loads the user fresh, so role/category changes apply at once. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "Sign in to continue");
  let userId: number;
  try {
    userId = Number((jwt.verify(token, JWT_SECRET) as jwt.JwtPayload).sub);
  } catch {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.isActive) throw new HttpError(401, "Your account is disabled");
  req.user = { id: user.id, role: user.role, restaurantId: user.restaurantId, categoryIds: user.categoryIds };
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, "You don't have permission to do this");
    }
    next();
  };
}

/** Restaurant-scoped routes: user must belong to a restaurant with a live subscription. */
export const requireRestaurant: RequestHandler = async (req, _res, next) => {
  const rid = req.user?.restaurantId;
  if (!rid) throw new HttpError(403, "This area is for restaurant accounts");
  await assertRestaurantAccess(rid);
  next();
};

export function restaurantId(req: { user?: AuthUser }): number {
  const rid = req.user?.restaurantId;
  if (!rid) throw new HttpError(403, "This area is for restaurant accounts");
  return rid;
}
