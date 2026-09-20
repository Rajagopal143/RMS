import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { loadDbEnv } from "./load-env.js";

export * from "./schema.js";

loadDbEnv();

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export const client = postgres(requireDatabaseUrl());
export const db = drizzle(client, { schema });

export async function verifyDatabaseConnection(): Promise<void> {
  await db.execute(sql`select 1`);
}
