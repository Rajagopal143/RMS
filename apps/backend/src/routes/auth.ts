import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, restaurants, users } from "@workspace/db";
import { assertRestaurantAccess, requireAuth, signToken } from "../lib/auth.js";
import { HttpError, parse } from "../lib/http.js";

export const authRouter = Router();

async function sessionUser(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new HttpError(401, "Account not found");
  const restaurant = user.restaurantId
    ? ((await db.select().from(restaurants).where(eq(restaurants.id, user.restaurantId)))[0] ?? null)
    : null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
    categoryIds: user.categoryIds,
    restaurant,
  };
}

authRouter.post("/login", async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), req.body);
  const [user] = await db.select().from(users).where(eq(users.email, body.email));
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    throw new HttpError(401, "Email or password is incorrect");
  }
  if (!user.isActive) throw new HttpError(403, "Your account is disabled. Ask your manager.");
  if (user.restaurantId) await assertRestaurantAccess(user.restaurantId);
  res.json({ token: signToken(user.id), user: await sessionUser(user.id) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.restaurantId) await assertRestaurantAccess(user.restaurantId);
  res.json(await sessionUser(user.id));
});
