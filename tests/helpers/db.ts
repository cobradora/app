import { db } from "@/db";
import { sql } from "drizzle-orm";

const TABLES = [
  "audit_events",
  "webhook_events",
  "commissions",
  "gateway_accounts",
  "payment_allocations",
  "payments",
  "checkout_items",
  "checkout_sessions",
  "charges",
  "billing_periods",
  "group_participants",
  "group_tags",
  "participants",
  "financial_contacts",
  "groups",
  "organization_settings",
  "users",
  "organizations",
];

export async function truncateAll() {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}
