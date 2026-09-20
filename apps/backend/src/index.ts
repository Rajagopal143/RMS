import "dotenv/config";
import express, { Router } from "express";
import cors from "cors";
import { verifyDatabaseConnection } from "@workspace/db";
import { requireAuth, requireRestaurant } from "./lib/auth.js";
import { errorHandler } from "./lib/http.js";
import { authRouter } from "./routes/auth.js";
import { platformRouter } from "./routes/platform.js";
import { setupRouter } from "./routes/setup.js";
import { ordersRouter } from "./routes/orders.js";
import { expensesRouter } from "./routes/expenses.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

// Admin runs in Electron (file:// origin) and kitchen tablets on the LAN; auth is by bearer token.
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/platform", platformRouter);
// Restaurant-scoped API: signed-in staff of a restaurant with a live subscription.
const restaurantApi = Router();
restaurantApi.use(requireAuth, requireRestaurant, setupRouter, ordersRouter, expensesRouter);
app.use("/api", restaurantApi);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

async function start(): Promise<void> {
  await verifyDatabaseConnection();
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

start().catch((err: unknown) => {
  console.error("Database unavailable; server not started.", err);
  process.exit(1);
});
