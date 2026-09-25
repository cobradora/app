import { db } from "@/db";
import { sql } from "drizzle-orm";

const TABLES = [
  "rate_limit_hits",
  "audit_events",
  "webhook_events",
  "whatsapp_notifications",
  "commissions",
  "gateway_accounts",
  "payment_allocations",
  "payments",
  "checkout_items",
  "organization_ledger_entries",
  "gateway_deposits",
  "withdrawals",
  "organization_balances",
  "organization_payout_profiles",
  "payer_gateway_profiles",
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
