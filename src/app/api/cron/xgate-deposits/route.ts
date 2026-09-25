import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { gatewayDeposits } from "@/db/schema";
import { reconcileXGateDeposit } from "@/services/xgate-deposits";

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
  const pending = await db.select({ id: gatewayDeposits.id }).from(gatewayDeposits).where(and(eq(gatewayDeposits.provider, "xgate"), inArray(gatewayDeposits.status, ["created", "pending"]), isNotNull(gatewayDeposits.providerTransactionId))).orderBy(asc(gatewayDeposits.updatedAt)).limit(4);
  const outcomes = await Promise.allSettled(pending.map(async ({ id }) => {
    try { await reconcileXGateDeposit(id); }
    finally { await db.update(gatewayDeposits).set({ updatedAt: new Date() }).where(eq(gatewayDeposits.id, id)); }
  }));
  const failures = outcomes.filter(result => result.status === "rejected").length;
  return NextResponse.json({ examined: pending.length, failures }, { status: failures ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
