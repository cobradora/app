import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only reads the schema file and needs no live
// connection, so it is intentionally run without a dotenv wrapper (see
// package.json). `migrate` (and `push`) do need a real DATABASE_URL, which
// is injected per-environment via `dotenv -e .env.local` / `.env.test`.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://placeholder/unused";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
