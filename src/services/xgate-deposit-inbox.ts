import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { gatewayDeposits, webhookEvents } from "@/db/schema";
import { reconcileXGateDeposit } from "./xgate-deposits";

/** Hints are untrusted: reconciliation always verifies the authenticated provider response.
 * Concurrent workers are safe because the ledger locks and deduplicates each deposit. */
export async function processXGateDepositInbox() {
  const events = await db.select().from(webhookEvents).where(and(
    eq(webhookEvents.provider, "xgate"), eq(webhookEvents.eventType, "deposit.notice"),
    inArray(webhookEvents.processingStatus, ["received", "failed"]),
    isNotNull(webhookEvents.reconciliationHint),
  )).orderBy(sql`coalesce(${webhookEvents.processedAt}, ${webhookEvents.receivedAt})`).limit(4);
  const outcomes = await Promise.allSettled(events.map(async event => {
    try {
      const hint = event.reconciliationHint!;
      await reconcileXGateDeposit(hint.depositId, hint.transactionId);
      const [deposit] = await db.select({ status: gatewayDeposits.status, providerTransactionId: gatewayDeposits.providerTransactionId }).from(gatewayDeposits).where(eq(gatewayDeposits.id, hint.depositId));
      // Never retire the only recoverable transaction hint after a lost creation response.
      // Known transaction IDs are subsequently monitored by the deposit reconciliation cron.
      if (!deposit || (["created", "pending"].includes(deposit.status) && !deposit.providerTransactionId)) {
        throw new Error("Deposit still requires its webhook hint");
      }
      await db.update(webhookEvents).set({ processingStatus: "processed", processedAt: new Date(), errorMessage: null }).where(eq(webhookEvents.id, event.id));
    } catch {
      // Do not regress an event completed by another worker.
      await db.update(webhookEvents).set({ processingStatus: "failed", processedAt: new Date(), errorMessage: "Reconciliation required" }).where(and(eq(webhookEvents.id, event.id), inArray(webhookEvents.processingStatus, ["received", "failed"])));
      throw new Error("Deposit reconciliation unavailable");
    }
  }));
  return { examined: events.length, failures: outcomes.filter(result => result.status === "rejected").length };
}
