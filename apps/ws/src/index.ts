import "dotenv/config";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { WebSocketServer, type WebSocket } from "ws";

const port = Number(process.env.PORT) || 3002;
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = postgres(databaseUrl);

interface Client {
  socket: WebSocket;
  userId: number;
  role: string;
  restaurantId: number;
  categoryIds: number[];
  alive: boolean;
}

interface RealtimeEvent {
  type: "order.created" | "order.updated" | "item.updated";
  restaurantId: number;
  orderId: number;
  status?: string;
  categoryIds?: number[];
}

const clients = new Set<Client>();

/** Who should hear about an event: cooks only for foods in their categories; everyone else in the restaurant sees all. */
function shouldReceive(client: Client, event: RealtimeEvent): boolean {
  if (client.restaurantId !== event.restaurantId) return false;
  if (client.role === "cook") {
    return (event.categoryIds ?? []).some((id) => client.categoryIds.includes(id));
  }
  return true;
}

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("RMS realtime service. Connect with a WebSocket client and ?token=<jwt>.");
});

const wss = new WebSocketServer({ server });

wss.on("connection", async (socket, req) => {
  const token = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
  let userId: number;
  try {
    userId = Number((jwt.verify(token ?? "", JWT_SECRET) as jwt.JwtPayload).sub);
  } catch {
    socket.close(4001, "Invalid or expired session");
    return;
  }

  const [user] = await sql<{ role: string; restaurant_id: number | null; category_ids: number[]; is_active: boolean }[]>`
    select role, restaurant_id, category_ids, is_active from users where id = ${userId}
  `;
  if (!user?.is_active || !user.restaurant_id) {
    socket.close(4003, "Account can't receive restaurant updates");
    return;
  }

  const client: Client = {
    socket,
    userId,
    role: user.role,
    restaurantId: user.restaurant_id,
    categoryIds: user.category_ids,
    alive: true,
  };
  clients.add(client);
  socket.send(JSON.stringify({ type: "welcome", role: client.role, categoryIds: client.categoryIds }));

  socket.on("pong", () => {
    client.alive = true;
  });
  socket.on("close", () => clients.delete(client));
  socket.on("error", (err) => console.error("Socket error:", err));
});

// Drop connections that stop answering pings (tablets going to sleep, Wi-Fi drops).
const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (!client.alive) {
      client.socket.terminate();
      clients.delete(client);
      continue;
    }
    client.alive = false;
    client.socket.ping();
  }
}, 30_000);
wss.on("close", () => clearInterval(heartbeat));

/**
 * Re-reads role, categories and active flag for this restaurant's connected users, so a manager
 * changing a cook's categories (or disabling a login) takes effect without the cook reconnecting.
 */
async function refreshClients(restaurantId: number) {
  const here = [...clients].filter((c) => c.restaurantId === restaurantId);
  if (here.length === 0) return;
  const rows = await sql<{ id: number; role: string; category_ids: number[]; is_active: boolean }[]>`
    select id, role, category_ids, is_active from users where id in ${sql(here.map((c) => c.userId))}
  `;
  for (const client of here) {
    const row = rows.find((r) => r.id === client.userId);
    if (!row?.is_active) {
      client.socket.close(4003, "Account disabled");
      clients.delete(client);
      continue;
    }
    client.role = row.role;
    client.categoryIds = row.category_ids;
  }
}

await sql.listen("rms_events", async (payload) => {
  let event: RealtimeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return;
  }
  try {
    await refreshClients(event.restaurantId);
  } catch (err) {
    console.error("Couldn't refresh connected users", err);
  }
  const frame = JSON.stringify(event);
  for (const client of clients) {
    if (shouldReceive(client, event)) client.socket.send(frame);
  }
});

server.listen(port, () => {
  console.log(`WebSocket listening on ws://localhost:${port}`);
});
