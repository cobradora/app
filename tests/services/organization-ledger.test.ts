import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, financialContacts, gatewayDeposits, withdrawals } from "@/db/schema";
import {
  calculatePaymentAmounts,
  creditConfirmedDeposit,
  refundConfirmedDeposit,
  reserveWithdrawal,
  settleWithdrawal,
  releaseWithdrawal,
  getOrganizationBalance,
} from "@/services/organization-ledger";
import { truncateAll } from "../helpers/db";

async function insertDeposit(organizationId: string, financialContactId: string, opts: { grossAmount: number; providerTransactionId: string }) {
  const { grossAmount, feeRateBps, feeAmount, netAmount } = calculatePaymentAmounts(opts.grossAmount);
  const [deposit] = await db
    .insert(gatewayDeposits)
    .values({
      organizationId,
      financialContactId,
      provider: "xgate",
      providerTransactionId: opts.providerTransactionId,
      grossAmount,
      feeRateBps,
      feeAmount,
      netAmount,
    })
    .returning();
  return deposit;
}

async function insertWithdrawal(organizationId: string, amount: number) {
  const [withdrawal] = await db
    .insert(withdrawals)
    .values({
      organizationId,
      provider: "xgate",
      amount,
      idempotencyKey: crypto.randomUUID(),
      beneficiarySnapshot: { pixKeyType: "email", pixKey: "org@example.com" },
    })
    .returning();
  return withdrawal;
}

async function creditNewDeposit(organizationId: string, financialContactId: string, grossAmount: number, providerTransactionId: string) {
  const deposit = await insertDeposit(organizationId, financialContactId, { grossAmount, providerTransactionId });
  await creditConfirmedDeposit({ organizationId, depositId: deposit.id });
  return deposit;
}

describe("organization-ledger", () => {
  let organizationId: string;
  let financialContactId: string;

  beforeEach(async () => {
    await truncateAll();
    const [org] = await db.insert(organizations).values({ name: "Org Teste" }).returning();
    organizationId = org.id;
    const [contact] = await db
      .insert(financialContacts)
      .values({ organizationId, phoneNormalized: "+5511900000000", phoneDisplay: "(11) 90000-0000" })
      .returning();
    financialContactId = contact.id;
  });

  describe("creditConfirmedDeposit", () => {
    it("credita o valor líquido (bruto - taxa) no saldo liquidado", async () => {
      const deposit = await insertDeposit(organizationId, financialContactId, { grossAmount: 10000, providerTransactionId: "dep-1" });
      const result = await creditConfirmedDeposit({ organizationId, depositId: deposit.id });

      expect(result.credited).toBe(true);
      const balance = await getOrganizationBalance(organizationId);
      expect(balance.settledAmount).toBe(deposit.netAmount);
      expect(balance.availableAmount).toBe(deposit.netAmount);

      const [updated] = await db.select().from(gatewayDeposits).where(eq(gatewayDeposits.id, deposit.id));
      expect(updated.status).toBe("confirmed");
    });

    it("é idempotente por operationId: creditar o mesmo depósito duas vezes não dobra o saldo", async () => {
      const deposit = await insertDeposit(organizationId, financialContactId, { grossAmount: 10000, providerTransactionId: "dep-2" });
      await creditConfirmedDeposit({ organizationId, depositId: deposit.id });
      const second = await creditConfirmedDeposit({ organizationId, depositId: deposit.id });

      expect(second.credited).toBe(false);
      const balance = await getOrganizationBalance(organizationId);
      expect(balance.settledAmount).toBe(deposit.netAmount);
    });
  });

  describe("refundConfirmedDeposit", () => {
    it("estorna o valor líquido previamente creditado", async () => {
      const deposit = await creditNewDeposit(organizationId, financialContactId, 10000, "dep-3");
      const result = await refundConfirmedDeposit({ organizationId, depositId: deposit.id });

      expect(result.refunded).toBe(true);
      const balance = await getOrganizationBalance(organizationId);
      expect(balance.settledAmount).toBe(0);

      const [updated] = await db.select().from(gatewayDeposits).where(eq(gatewayDeposits.id, deposit.id));
      expect(updated.status).toBe("refunded");
    });

    it("é idempotente: estornar duas vezes não debita duas vezes", async () => {
      const deposit = await creditNewDeposit(organizationId, financialContactId, 10000, "dep-4");
      await refundConfirmedDeposit({ organizationId, depositId: deposit.id });
      const second = await refundConfirmedDeposit({ organizationId, depositId: deposit.id });

      expect(second.refunded).toBe(false);
      const balance = await getOrganizationBalance(organizationId);
      expect(balance.settledAmount).toBe(0);
    });
  });

  describe("saques", () => {
    it("reservar move o valor de disponível para reservado sem alterar o saldo liquidado", async () => {
      await creditNewDeposit(organizationId, financialContactId, 10000, "dep-reserve");
      const withdrawal = await insertWithdrawal(organizationId, 4000);
      const before = await getOrganizationBalance(organizationId);

      await reserveWithdrawal({ organizationId, withdrawalId: withdrawal.id });

      const after = await getOrganizationBalance(organizationId);
      expect(after.settledAmount).toBe(before.settledAmount);
      expect(after.reservedAmount).toBe(4000);
      expect(after.availableAmount).toBe(before.availableAmount - 4000);

      const [updated] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id));
      expect(updated.status).toBe("reserved");
    });

    it("reservar sem saldo disponível suficiente falha com INSUFFICIENT_BALANCE", async () => {
      await creditNewDeposit(organizationId, financialContactId, 1000, "dep-low");
      const balance = await getOrganizationBalance(organizationId);
      const withdrawal = await insertWithdrawal(organizationId, balance.availableAmount + 1);

      await expect(reserveWithdrawal({ organizationId, withdrawalId: withdrawal.id })).rejects.toThrow("INSUFFICIENT_BALANCE");
    });

    it("reservar a mesma solicitação duas vezes não reserva o valor duas vezes", async () => {
      await creditNewDeposit(organizationId, financialContactId, 20000, "dep-idem");
      const withdrawal = await insertWithdrawal(organizationId, 5000);

      await reserveWithdrawal({ organizationId, withdrawalId: withdrawal.id });
      await reserveWithdrawal({ organizationId, withdrawalId: withdrawal.id });

      const balance = await getOrganizationBalance(organizationId);
      expect(balance.reservedAmount).toBe(5000);
    });

    it("apenas uma de duas reservas concorrentes sobre o mesmo saldo insuficiente é aprovada", async () => {
      await creditNewDeposit(organizationId, financialContactId, 10000, "dep-race");
      const [w1, w2] = await Promise.all([insertWithdrawal(organizationId, 6000), insertWithdrawal(organizationId, 6000)]);

      const results = await Promise.allSettled([
        reserveWithdrawal({ organizationId, withdrawalId: w1.id }),
        reserveWithdrawal({ organizationId, withdrawalId: w2.id }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.message).toBe("INSUFFICIENT_BALANCE");

      const balance = await getOrganizationBalance(organizationId);
      expect(balance.reservedAmount).toBe(6000);
    });

    it("liquidar reduz saldo liquidado e reservado, e marca a solicitação como concluída", async () => {
      await creditNewDeposit(organizationId, financialContactId, 10000, "dep-settle");
      const withdrawal = await insertWithdrawal(organizationId, 4000);
      await reserveWithdrawal({ organizationId, withdrawalId: withdrawal.id });
      const before = await getOrganizationBalance(organizationId);

      await settleWithdrawal({ organizationId, withdrawalId: withdrawal.id });

      const after = await getOrganizationBalance(organizationId);
      expect(after.settledAmount).toBe(before.settledAmount - 4000);
      expect(after.reservedAmount).toBe(0);

      const [updated] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id));
      expect(updated.status).toBe("completed");
    });

    it("liberar restitui o reservado sem alterar o saldo liquidado, e marca a solicitação como falha", async () => {
      await creditNewDeposit(organizationId, financialContactId, 10000, "dep-release");
      const withdrawal = await insertWithdrawal(organizationId, 4000);
      await reserveWithdrawal({ organizationId, withdrawalId: withdrawal.id });
      const before = await getOrganizationBalance(organizationId);

      await releaseWithdrawal({ organizationId, withdrawalId: withdrawal.id });

      const after = await getOrganizationBalance(organizationId);
      expect(after.settledAmount).toBe(before.settledAmount);
      expect(after.reservedAmount).toBe(0);

      const [updated] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id));
      expect(updated.status).toBe("failed");
    });

    it("liquidar sem reservar antes falha com INVALID_WITHDRAWAL_STATE", async () => {
      const withdrawal = await insertWithdrawal(organizationId, 1000);
      await expect(settleWithdrawal({ organizationId, withdrawalId: withdrawal.id })).rejects.toThrow("INVALID_WITHDRAWAL_STATE");
    });

    it("liquidar a mesma solicitação duas vezes não debita o saldo duas vezes", async () => {
      await creditNewDeposit(organizationId, financialContactId, 10000, "dep-settle-idem");
      const withdrawal = await insertWithdrawal(organizationId, 4000);
      await reserveWithdrawal({ organizationId, withdrawalId: withdrawal.id });
      await settleWithdrawal({ organizationId, withdrawalId: withdrawal.id });
      const before = await getOrganizationBalance(organizationId);

      await settleWithdrawal({ organizationId, withdrawalId: withdrawal.id });

      const after = await getOrganizationBalance(organizationId);
      expect(after.settledAmount).toBe(before.settledAmount);
      expect(after.reservedAmount).toBe(before.reservedAmount);
    });

    it("liberar a mesma solicitação duas vezes não restitui o reservado duas vezes", async () => {
      await creditNewDeposit(organizationId, financialContactId, 10000, "dep-release-idem");
      const w1 = await insertWithdrawal(organizationId, 4000);
      const w2 = await insertWithdrawal(organizationId, 1000);
      await reserveWithdrawal({ organizationId, withdrawalId: w1.id });
      await reserveWithdrawal({ organizationId, withdrawalId: w2.id });
      await releaseWithdrawal({ organizationId, withdrawalId: w1.id });
      const before = await getOrganizationBalance(organizationId);

      await releaseWithdrawal({ organizationId, withdrawalId: w1.id });

      const after = await getOrganizationBalance(organizationId);
      expect(after.reservedAmount).toBe(before.reservedAmount);
      expect(after.reservedAmount).toBe(1000);
    });
  });
});
