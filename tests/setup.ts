import { beforeAll, afterAll } from "vitest";
import { pool } from "@/db";

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.end();
});
