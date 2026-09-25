import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { gatewayDeposits, organizationBalances, organizationLedgerEntries, withdrawals } from "@/db/schema";

export type LedgerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const PLATFORM_FEE_BPS = 300;

/** A verified post-payment status change freezes availability until reconciled.
 * An explicit review-resolved audit record may only follow financial reconciliation.
 */
export async function isOrganizationBalanceUnderReview(organizationId: string, transaction?: LedgerTransaction) {
  const result = await (transaction ?? db).execute(sql`
    select 1 from audit_events review
    where review.organization_id = ${organizationId}
      and review.action = 'xgate_deposit_review'
      and not exists (
        select 1 from audit_events resolution
        where resolution.organization_id = review.organization_id
          and resolution.entity_id = review.entity_id
          and resolution.action = 'xgate_deposit_review_resolved'
          and resolution.created_at >= review.created_at
      ) limit 1
  `);
  return result.rows.length > 0;
}

/** Integer cents, round half up on each payment; snapshot survives future fee changes. */
export function calculatePaymentAmounts(grossAmount: number, feeRateBps = PLATFORM_FEE_BPS) {
  if (!Number.isInteger(grossAmount) || grossAmount <= 0 || grossAmount > 2147483647) throw new Error("INVALID_AMOUNT");
  if (!Number.isInteger(feeRateBps) || feeRateBps < 0 || feeRateBps > 10000) throw new Error("INVALID_FEE");
  const feeAmount = Number((BigInt(grossAmount) * BigInt(feeRateBps) + BigInt(5000)) / BigInt(10000));
  return { grossAmount, feeRateBps, feeAmount, netAmount: grossAmount - feeAmount };
}

async function lockBalance(tx: LedgerTransaction, organizationId: string) {
  await tx.insert(organizationBalances).values({ organizationId }).onConflictDoNothing();
  const [balance] = await tx.select().from(organizationBalances)
    .where(eq(organizationBalances.organizationId, organizationId)).for("update");
  return balance;
}

async function mutateBalance(tx: LedgerTransaction, organizationId: string, amount: number, reservedDelta: number) {
  await tx.update(organizationBalances).set({
    settledAmount: sql`${organizationBalances.settledAmount} + ${amount}`,
    reservedAmount: sql`${organizationBalances.reservedAmount} + ${reservedDelta}`,
    updatedAt: new Date(),
  }).where(eq(organizationBalances.organizationId, organizationId));
}

export async function getOrganizationBalance(organizationId: string) {
  const [row] = await db.select().from(organizationBalances).where(eq(organizationBalances.organizationId, organizationId));
  const settledAmount = row?.settledAmount ?? 0;
  const reservedAmount = row?.reservedAmount ?? 0;
  const underReview = await isOrganizationBalanceUnderReview(organizationId);
  return { settledAmount, reservedAmount, availableAmount: underReview ? 0 : settledAmount - reservedAmount };
}

/** Caller must verify provider settlement first. Optional tx joins payment/allocation changes atomically.
 * Ledger books NET once; gross and fee are immutable metadata, never additional balance debits.
 */
export async function creditConfirmedDeposit(input: { organizationId: string; depositId: string }, transaction?: LedgerTransaction) {
  const run = async (tx: LedgerTransaction) => {
    await lockBalance(tx, input.organizationId);
    const [deposit] = await tx.select().from(gatewayDeposits).where(and(eq(gatewayDeposits.id, input.depositId), eq(gatewayDeposits.organizationId, input.organizationId))).for("update");
    if (!deposit || deposit.provider !== "xgate" || !deposit.providerTransactionId) throw new Error("INVALID_DEPOSIT");
    if (deposit.status === "refunded" || deposit.status === "failed") throw new Error("INVALID_DEPOSIT_STATE");
    const [entry] = await tx.insert(organizationLedgerEntries).values({
      organizationId: input.organizationId, provider: deposit.provider, operationId: `deposit:${deposit.providerTransactionId}`,
      kind: "deposit", depositId: deposit.id, amount: deposit.netAmount,
      grossAmount: deposit.grossAmount, feeAmount: deposit.feeAmount, feeRateBps: deposit.feeRateBps,
    }).onConflictDoNothing().returning();
    if (entry) await mutateBalance(tx, input.organizationId, deposit.netAmount, 0);
    await tx.update(gatewayDeposits).set({ status: "confirmed", updatedAt: new Date() }).where(eq(gatewayDeposits.id, deposit.id));
    return { credited: Boolean(entry), deposit };
  };
  return transaction ? run(transaction) : db.transaction(run);
}

export async function refundConfirmedDeposit(input: { organizationId: string; depositId: string }, transaction?: LedgerTransaction) {
  const run = async (tx: LedgerTransaction) => {
    await lockBalance(tx, input.organizationId);
    const [deposit] = await tx.select().from(gatewayDeposits).where(and(eq(gatewayDeposits.id, input.depositId), eq(gatewayDeposits.organizationId, input.organizationId))).for("update");
    if (!deposit || !deposit.providerTransactionId || deposit.provider !== "xgate" || !["confirmed", "refunded"].includes(deposit.status)) throw new Error("INVALID_REFUND");
    const [entry] = await tx.insert(organizationLedgerEntries).values({
      organizationId: input.organizationId, provider: deposit.provider, operationId: `refund:${deposit.providerTransactionId}`,
      kind: "refund", depositId: deposit.id, amount: -deposit.netAmount,
      grossAmount: -deposit.grossAmount, feeAmount: -deposit.feeAmount, feeRateBps: deposit.feeRateBps,
    }).onConflictDoNothing().returning();
    // Refunds may create debt when funds were previously withdrawn; future withdrawals remain blocked.
    if (entry) await mutateBalance(tx, input.organizationId, -deposit.netAmount, 0);
    await tx.update(gatewayDeposits).set({ status: "refunded", updatedAt: new Date() }).where(eq(gatewayDeposits.id, deposit.id));
    return { refunded: Boolean(entry) };
  };
  return transaction ? run(transaction) : db.transaction(run);
}

async function transitionWithdrawal(input: { organizationId: string; withdrawalId: string }, action: "reserve" | "settle" | "release", transaction?: LedgerTransaction) {
  const run = async (tx: LedgerTransaction) => {
    const balance = await lockBalance(tx, input.organizationId);
    const [withdrawal] = await tx.select().from(withdrawals).where(and(eq(withdrawals.id, input.withdrawalId), eq(withdrawals.organizationId, input.organizationId))).for("update");
    if (!withdrawal || withdrawal.provider !== "xgate") throw new Error("INVALID_WITHDRAWAL");
    const operationId = `withdrawal:${withdrawal.id}:${action}`;
    const [previous] = await tx.select().from(organizationLedgerEntries).where(and(eq(organizationLedgerEntries.provider, withdrawal.provider), eq(organizationLedgerEntries.operationId, operationId)));
    if (previous) return withdrawal;
    if (action === "reserve") {
      if (await isOrganizationBalanceUnderReview(input.organizationId, tx)) throw new Error("BALANCE_UNDER_REVIEW");
      if (withdrawal.status !== "created") throw new Error("INVALID_WITHDRAWAL_STATE");
      if (balance.settledAmount - balance.reservedAmount < withdrawal.amount) throw new Error("INSUFFICIENT_BALANCE");
    } else if (!["reserved", "pending"].includes(withdrawal.status)) throw new Error("INVALID_WITHDRAWAL_STATE");
    const amount = action === "settle" ? -withdrawal.amount : 0;
    const reservedDelta = action === "reserve" ? withdrawal.amount : -withdrawal.amount;
    await tx.insert(organizationLedgerEntries).values({ organizationId: input.organizationId, provider: withdrawal.provider, operationId, kind: `withdrawal_${action}`, withdrawalId: withdrawal.id, amount, reservedDelta });
    await mutateBalance(tx, input.organizationId, amount, reservedDelta);
    const [updated] = await tx.update(withdrawals).set({ status: action === "reserve" ? "reserved" : action === "settle" ? "completed" : "failed", updatedAt: new Date() }).where(eq(withdrawals.id, withdrawal.id)).returning();
    return updated;
  };
  return transaction ? run(transaction) : db.transaction(run);
}

export const reserveWithdrawal = (input: { organizationId: string; withdrawalId: string }, tx?: LedgerTransaction) => transitionWithdrawal(input, "reserve", tx);
export const settleWithdrawal = (input: { organizationId: string; withdrawalId: string }, tx?: LedgerTransaction) => transitionWithdrawal(input, "settle", tx);
export const releaseWithdrawal = (input: { organizationId: string; withdrawalId: string }, tx?: LedgerTransaction) => transitionWithdrawal(input, "release", tx);
