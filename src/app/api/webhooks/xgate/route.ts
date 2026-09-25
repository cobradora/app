import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { gatewayDeposits, webhookEvents, withdrawals } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { reconcileXGateWithdrawal } from "@/services/xgate-payouts";

export const runtime = "nodejs";
const eventShape = { id: z.string().min(1).max(200), externalId: z.string().uuid().optional(), status: z.string().min(1).max(60) };
const input = z.discriminatedUnion("operation", [
  z.object({ ...eventShape, operation: z.literal("DEPOSIT") }),
  z.object({ ...eventShape, operation: z.literal("WITHDRAW") }),
]);
export async function POST(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 16384) return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = input.safeParse(value);
  if (!parsed.success) return NextResponse.json({ error: "unsupported_event" }, { status: 400 });
  const event = parsed.data;
  const isDeposit = event.operation === "DEPOSIT";
  const table = isDeposit ? gatewayDeposits : withdrawals;
  const [record] = await db.select().from(table).where(and(eq(table.provider, "xgate"), event.externalId ? eq(table.id, event.externalId) : eq(table.providerTransactionId, event.id)));
  if (!record) return NextResponse.json({ received: true });
  if (record.providerTransactionId && record.providerTransactionId !== event.id) return NextResponse.json({ error: "transaction_mismatch" }, { status: 409 });
  if (!await checkRateLimit(`xgate-webhook:${record.id}`, 20, 60)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const hash = createHash("sha256").update(raw).digest("hex");
  const eventId = createHash("sha256").update(`${event.operation}:${event.id}:${event.status}:${hash}`).digest("hex");
  if (isDeposit) {
    // Persist before acknowledging. No external request delays the deposit webhook response.
    // The scheduled worker retries failures even after the payer closes the browser.
    try {
      await db.insert(webhookEvents).values({ provider: "xgate", externalEventId: eventId, eventType: "deposit.notice", payloadHash: hash, reconciliationHint: { depositId: record.id, transactionId: event.id } }).onConflictDoNothing();
      return NextResponse.json({ received: true });
    } catch {
      return NextResponse.json({ error: "notification_not_saved" }, { status: 503 });
    }
  }
  await db.insert(webhookEvents).values({ provider: "xgate", externalEventId: eventId, eventType: isDeposit ? "deposit.notice" : "withdraw.notice", payloadHash: hash }).onConflictDoNothing();
  try {
    // No trust in payload status/amount or spoofable IP headers. Only an authenticated
    // XGate GET matching our persisted order can authorize a financial mutation.
    await reconcileXGateWithdrawal(record.id, event.id);
    await db.update(webhookEvents).set({ processingStatus: "processed", processedAt: new Date(), errorMessage: null }).where(and(eq(webhookEvents.provider, "xgate"), eq(webhookEvents.externalEventId, eventId)));
    return NextResponse.json({ received: true });
  } catch {
    await db.update(webhookEvents).set({ processingStatus: "failed", errorMessage: "Reconciliation required" }).where(and(eq(webhookEvents.provider, "xgate"), eq(webhookEvents.externalEventId, eventId)));
    return NextResponse.json({ error: "reconciliation_unavailable" }, { status: 503 });
  }
}
