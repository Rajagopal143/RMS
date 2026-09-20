import { defineConfig } from "drizzle-kit";
import { loadDbEnv } from "./src/load-env.js";

loadDbEnv();

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
