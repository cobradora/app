import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, organizationBalances, organizationPayoutProfiles, organizations, withdrawals } from "@/db/schema";
import { registerPayoutProfile, requestWithdrawal, reconcileXGateWithdrawal } from "@/services/xgate-payouts";
import { XGateError } from "@/payments/xgate-client";
import { truncateAll } from "../helpers/db";

const mockClient = vi.hoisted(() => ({
  getCustomer: vi.fn(),
  createCustomer: vi.fn(),
  listPixKeys: vi.fn(),
  addPixKey: vi.fn(),
  getBrlCurrency: vi.fn(),
  createWithdrawal: vi.fn(),
  getWithdrawal: vi.fn(),
}));

vi.mock("@/payments/xgate-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/payments/xgate-client")>();
  return { ...actual, getXGateClient: () => mockClient };
});

async function seedActiveProfile(organizationId: string, overrides: Partial<{ providerCustomerId: string; providerPixKeyId: string; pixKeyType: string; pixKey: string }> = {}) {
  await db.insert(organizationPayoutProfiles).values({
    organizationId, name: "Organizador Teste", document: "52998224725",
    pixKeyType: overrides.pixKeyType ?? "EMAIL", pixKey: overrides.pixKey ?? "org@example.com",
    providerCustomerId: overrides.providerCustomerId ?? "cust-1", providerPixKeyId: overrides.providerPixKeyId ?? "key-1",
    status: "active",
  });
}

async function seedBalance(organizationId: string, settledAmount: number) {
  await db.insert(organizationBalances).values({ organizationId, settledAmount });
}

const currency = { _id: "cur-1", name: "BRL" as const, type: "PIX" as const, symbol: "R$" };
const idempotencyKey = (suffix: string) => `wd:test:case-${suffix}`;

describe("xgate-payouts", () => {
  let organizationId: string;

  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    const [org] = await db.insert(organizations).values({ name: "Org Teste", billingModule: "cobradora", organizerPhoneNormalized: "+5511900000000", organizerPhoneDisplay: "(11) 90000-0000" }).returning();
    organizationId = org.id;
    process.env.XGATE_ENABLED = "true";
    process.env.XGATE_ORGANIZATION_IDS = organizationId;
  });

  describe("registerPayoutProfile", () => {
    it("cria o customer e a chave Pix na XGate e marca o perfil como ativo", async () => {
      mockClient.createCustomer.mockResolvedValue({ customer: { _id: "cust-new" } });
      mockClient.getCustomer.mockResolvedValue({ _id: "cust-new", document: "52998224725" });
      mockClient.listPixKeys.mockResolvedValue([]);
      mockClient.addPixKey.mockResolvedValue({ key: { _id: "key-new", key: "org@example.com", type: "EMAIL" } });

      const result = await registerPayoutProfile(organizationId, { name: "Organizador", document: "529.982.247-25", pixKeyType: "EMAIL", pixKey: "org@example.com" });

      expect(result.status).toBe("active");
      expect(mockClient.createCustomer).toHaveBeenCalledTimes(1);
      expect(mockClient.addPixKey).toHaveBeenCalledWith("cust-new", { key: "org@example.com", type: "EMAIL" });
      const [profile] = await db.select().from(organizationPayoutProfiles).where(eq(organizationPayoutProfiles.organizationId, organizationId));
      expect(profile.status).toBe("active");
      expect(profile.providerCustomerId).toBe("cust-new");
      expect(profile.providerPixKeyId).toBe("key-new");
    });
  });

  describe("requestWithdrawal", () => {
    it("falha com insufficient_balance quando o disponível é menor que o pedido", async () => {
      await seedActiveProfile(organizationId);
      await seedBalance(organizationId, 1000);

      await expect(requestWithdrawal(organizationId, { amountCents: 5000, idempotencyKey: idempotencyKey("1") }))
        .rejects.toMatchObject({ code: "insufficient_balance" });
      expect(mockClient.createWithdrawal).not.toHaveBeenCalled();
    });

    it("falha com balance_under_review quando há um depósito em revisão", async () => {
      await seedActiveProfile(organizationId);
      await seedBalance(organizationId, 10000);
      await db.insert(auditEvents).values({ organizationId, entityType: "gateway_deposit", entityId: crypto.randomUUID(), actorType: "system", action: "xgate_deposit_review" });

      await expect(requestWithdrawal(organizationId, { amountCents: 5000, idempotencyKey: idempotencyKey("2") }))
        .rejects.toMatchObject({ code: "balance_under_review" });
      expect(mockClient.createWithdrawal).not.toHaveBeenCalled();
    });

    it("resultado ambíguo mantém a reserva presa", async () => {
      await seedActiveProfile(organizationId);
      await seedBalance(organizationId, 10000);
      mockClient.getBrlCurrency.mockResolvedValue(currency);
      mockClient.createWithdrawal.mockRejectedValue(new Error("network down"));

      const { withdrawalId } = await requestWithdrawal(organizationId, { amountCents: 5000, idempotencyKey: idempotencyKey("3") });

      const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      expect(row.status).toBe("reserved");
      expect(row.externalCreationState).toBe("ambiguous");
      const [balance] = await db.select().from(organizationBalances).where(eq(organizationBalances.organizationId, organizationId));
      expect(balance.reservedAmount).toBe(5000);
    });

    it("rejeição definitiva libera a reserva", async () => {
      await seedActiveProfile(organizationId);
      await seedBalance(organizationId, 10000);
      mockClient.getBrlCurrency.mockResolvedValue(currency);
      mockClient.createWithdrawal.mockRejectedValue(new XGateError("XGate respondeu HTTP 400.", "rejected", "http", 400));

      const { withdrawalId } = await requestWithdrawal(organizationId, { amountCents: 5000, idempotencyKey: idempotencyKey("4") });

      const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      expect(row.status).toBe("failed");
      const [balance] = await db.select().from(organizationBalances).where(eq(organizationBalances.organizationId, organizationId));
      expect(balance.reservedAmount).toBe(0);
      expect(balance.settledAmount).toBe(10000);
    });

    it("sucesso leva a status pending com o providerTransactionId gravado", async () => {
      await seedActiveProfile(organizationId);
      await seedBalance(organizationId, 10000);
      mockClient.getBrlCurrency.mockResolvedValue(currency);
      mockClient.createWithdrawal.mockResolvedValue({ _id: "wd-ext-1", status: "PENDING" });

      const { withdrawalId } = await requestWithdrawal(organizationId, { amountCents: 5000, idempotencyKey: idempotencyKey("5") });

      const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      expect(row.status).toBe("pending");
      expect(row.providerTransactionId).toBe("wd-ext-1");
      expect(row.externalCreationState).toBe("linked");
      expect(mockClient.createWithdrawal).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 5000, customerId: "cust-1", externalId: withdrawalId, pixKey: { _id: "key-1", key: "org@example.com", type: "EMAIL" } }));
    });

    it("é idempotente pela mesma idempotencyKey: não reserva nem chama a XGate duas vezes", async () => {
      await seedActiveProfile(organizationId);
      await seedBalance(organizationId, 10000);
      mockClient.getBrlCurrency.mockResolvedValue(currency);
      mockClient.createWithdrawal.mockResolvedValue({ _id: "wd-ext-2", status: "PENDING" });
      const key = idempotencyKey("6");

      const first = await requestWithdrawal(organizationId, { amountCents: 3000, idempotencyKey: key });
      const second = await requestWithdrawal(organizationId, { amountCents: 3000, idempotencyKey: key });

      expect(second.withdrawalId).toBe(first.withdrawalId);
      expect(mockClient.createWithdrawal).toHaveBeenCalledTimes(1);
      // Still reserved, not settled: settlement only happens via reconciliation.
      const [balance] = await db.select().from(organizationBalances).where(eq(organizationBalances.organizationId, organizationId));
      expect(balance.reservedAmount).toBe(3000);
      expect(balance.settledAmount).toBe(10000);
    });
  });

  describe("reconcileXGateWithdrawal", () => {
    async function seedPendingWithdrawal(amount: number) {
      await seedActiveProfile(organizationId);
      await seedBalance(organizationId, 10000);
      mockClient.getBrlCurrency.mockResolvedValue(currency);
      mockClient.createWithdrawal.mockResolvedValue({ _id: "wd-ext-3", status: "PENDING" });
      const { withdrawalId } = await requestWithdrawal(organizationId, { amountCents: amount, idempotencyKey: idempotencyKey("7") });
      return withdrawalId;
    }

    it("liquida quando a consulta autenticada confirma PAID", async () => {
      const withdrawalId = await seedPendingWithdrawal(4000);
      mockClient.getWithdrawal.mockResolvedValue({ _id: "wd-ext-3", customerId: "cust-1", externalId: withdrawalId, currency: { name: "BRL", type: "PIX", amount: 40, status: "PAID" } });

      await reconcileXGateWithdrawal(withdrawalId);

      const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      expect(row.status).toBe("completed");
      const [balance] = await db.select().from(organizationBalances).where(eq(organizationBalances.organizationId, organizationId));
      expect(balance.reservedAmount).toBe(0);
      expect(balance.settledAmount).toBe(10000 - 4000);
    });

    it("não libera nem liquida enquanto a consulta não confirmar PAID", async () => {
      const withdrawalId = await seedPendingWithdrawal(4000);
      mockClient.getWithdrawal.mockResolvedValue({ _id: "wd-ext-3", customerId: "cust-1", externalId: withdrawalId, currency: { name: "BRL", type: "PIX", amount: 40, status: "PENDING" } });

      await reconcileXGateWithdrawal(withdrawalId);

      const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      expect(row.status).toBe("pending");
      const [balance] = await db.select().from(organizationBalances).where(eq(organizationBalances.organizationId, organizationId));
      expect(balance.reservedAmount).toBe(4000);
    });
  });
});
