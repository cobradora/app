import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { withdrawals } from "@/db/schema";
import { reconcileXGateWithdrawal } from "@/services/xgate-payouts";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Only persisted transaction IDs. An ambiguous creation without an ID needs
  // a verifiable webhook or provider-assisted reconciliation, never another POST.
  const pending = await db.select({ id: withdrawals.id }).from(withdrawals).where(and(eq(withdrawals.provider, "xgate"), eq(withdrawals.status, "pending"), isNotNull(withdrawals.providerTransactionId))).orderBy(asc(withdrawals.updatedAt)).limit(4);
  const outcomes = await Promise.allSettled(pending.map(async ({ id }) => {
    try { await reconcileXGateWithdrawal(id); }
    finally { await db.update(withdrawals).set({ updatedAt: new Date() }).where(eq(withdrawals.id, id)); }
  }));
  const failures = outcomes.filter(result => result.status === "rejected").length;
  return NextResponse.json({ examined: pending.length, failures }, { status: failures ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
