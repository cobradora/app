import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";
import { db } from "@/db";
import { organizations, groups, gatewayAccounts, checkoutSessions, charges, billingPeriods } from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

vi.mock("@/payments", () => ({
  getPaymentsAdapter: vi.fn(),
}));

import { getPaymentsAdapter } from "@/payments";
import { createCheckoutForCharges, expireStaleCheckoutSessions } from "@/services/checkout";
import { InfinitePayCheckoutRequestError } from "@/payments/infinitepay-adapter";

function mockAdapter() {
  const createCheckout = vi.fn().mockImplementation(async (input: { externalReference?: string }) => ({
    gatewayCheckoutId: input.externalReference,
    checkoutUrl: `https://checkout.infinitepay.io/mock-${input.externalReference}`,
  }));
  (getPaymentsAdapter as unknown as Mock).mockReturnValue({
    createCheckout,
    getPayment: vi.fn(),
    refundPayment: vi.fn(),
    validateWebhook: vi.fn(),
    parseWebhook: vi.fn(),
  });
  return createCheckout;
}

describe("checkout service (InfinitePay, sem split)", () => {
  let organizationId: string;
  let groupPublicSlug: string;
  const phone = "(11) 90000-0009";

  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    mockAdapter();

    const [org] = await db.insert(organizations).values({ name: "Org Teste" }).returning();
    organizationId = org.id;
    const [group] = await db
      .insert(groups)
      .values({ organizationId, name: "Futebol", publicSlug: "futebol-abcd", billingDay: 10, defaultAmount: 9000 })
      .returning();
    groupPublicSlug = group.publicSlug;

    const participant = await findOrCreateParticipantByPhone(organizationId, phone, "Maria Responsável");
    await linkParticipantToGroup(organizationId, group.id, participant.id, new Date("2026-06-01T12:00:00Z"));

    await db.insert(gatewayAccounts).values({
      organizationId,
      provider: "infinitepay",
      externalAccountId: "handle-teste",
      status: "active",
    });

    await generateBillingPeriod(organizationId, group.id, "2026-07");
    await generateBillingPeriod(organizationId, group.id, "2026-08");
  });

  it("soma corretamente multiplas cobrancas pendentes (RB-006, nunca aceita valor do cliente)", async () => {
    const pendingCharges = await db.select().from(charges);
    expect(pendingCharges).toHaveLength(2);

    const result = await createCheckoutForCharges(
      groupPublicSlug,
      phone,
      pendingCharges.map((c) => c.id),
      "idem-soma-teste",
    );

    expect(result.totalChargesAmount).toBe(9000 + 9000);

    const createCheckout = (getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout;
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 18000, gatewayExternalAccountId: "handle-teste" }),
    );
  });

  it("reutiliza a mesma sessao para a mesma idempotencyKey (RB-009)", async () => {
    const pendingCharges = await db.select().from(charges);
    const chargeIds = [pendingCharges[0].id];

    const first = await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-repetida");
    const second = await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-repetida");

    expect(second.checkoutSessionId).toBe(first.checkoutSessionId);
    expect(second.checkoutUrl).toBe(first.checkoutUrl);

    const sessions = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.idempotencyKey, "idem-repetida"));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].checkoutUrl).toBe(first.checkoutUrl);
  });

  it("recupera a mesma sessao compativel mesmo quando o cliente perdeu a chave anterior", async () => {
    const pendingCharges = await db.select().from(charges);
    const chargeIds = [pendingCharges[0].id];

    const first = await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-chave-perdida-1");
    const recovered = await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-chave-nova-2");

    expect(recovered.checkoutSessionId).toBe(first.checkoutSessionId);
    expect(recovered.checkoutUrl).toBe(first.checkoutUrl);
    expect(recovered.resumed).toBe(true);
    expect((getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout).toHaveBeenCalledTimes(1);
  });

  it("no reuso da idempotencyKey, NAO rechama a InfinitePay (idempotencia real via checkoutUrl persistida)", async () => {
    const pendingCharges = await db.select().from(charges);
    const chargeIds = [pendingCharges[0].id];

    await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-sem-rechamada");

    const createCheckout = (getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout;
    expect(createCheckout).toHaveBeenCalledTimes(1);

    await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-sem-rechamada");

    expect(createCheckout).toHaveBeenCalledTimes(1);
  });

  it("nao cria uma segunda sessao para charge ja reservada; retoma a primeira", async () => {
    const pendingCharges = await db.select().from(charges);
    const chargeId = pendingCharges[0].id;

    const first = await createCheckoutForCharges(groupPublicSlug, phone, [chargeId], "idem-primeira-sessao");

    const [charge] = await db.select().from(charges).where(eq(charges.id, chargeId));
    expect(charge.status).toBe("checkout_pending");

    const resumed = await createCheckoutForCharges(
      groupPublicSlug,
      phone,
      [chargeId],
      "idem-segunda-sessao-diferente",
    );
    expect(resumed.checkoutSessionId).toBe(first.checkoutSessionId);
    expect(resumed.resumed).toBe(true);

    const sessions = await db.select().from(checkoutSessions);
    expect(sessions).toHaveLength(1);
  });

  it("libera a reserva das charges se a criacao do checkout na InfinitePay falhar", async () => {
    const pendingCharges = await db.select().from(charges);
    const chargeId = pendingCharges[0].id;

    (getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout.mockRejectedValueOnce(
      new InfinitePayCheckoutRequestError("payload rejeitado", false, 422),
    );

    await expect(createCheckoutForCharges(groupPublicSlug, phone, [chargeId], "idem-falha-gateway")).rejects.toThrow(
      /Não foi possível preparar/,
    );

    const [charge] = await db.select().from(charges).where(eq(charges.id, chargeId));
    expect(charge.status).toBe("open");

    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.idempotencyKey, "idem-falha-gateway"));
    expect(session.status).toBe("canceled");
  });

  it("mantem a reserva recuperavel quando a falha externa e ambigua", async () => {
    const [chargeBefore] = await db.select().from(charges);
    (getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout.mockRejectedValueOnce(
      new InfinitePayCheckoutRequestError("timeout", true),
    );

    await expect(
      createCheckoutForCharges(groupPublicSlug, phone, [chargeBefore.id], "idem-falha-ambigua"),
    ).rejects.toThrow(/Não foi possível preparar/);

    const [chargeAfter] = await db.select().from(charges).where(eq(charges.id, chargeBefore.id));
    expect(chargeAfter.status).toBe("checkout_pending");
    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.idempotencyKey, "idem-falha-ambigua"));
    expect(session.status).toBe("created");
    expect(session.externalCreationState).toBe("ambiguous");

    await db
      .update(checkoutSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(checkoutSessions.id, session.id));
    expect(await expireStaleCheckoutSessions()).toEqual({
      expired: 1,
      released: 0,
      awaitingReconciliation: 1,
    });

    await expect(
      createCheckoutForCharges(groupPublicSlug, phone, [chargeBefore.id], "idem-falha-ambigua"),
    ).rejects.toThrow(/reconciliada/);
    expect((getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout).toHaveBeenCalledTimes(1);
  });

  it("nao devolve URL vencida, libera a reserva vinculada e bloqueia link duplicado ate reconciliar", async () => {
    const [pendingCharge] = await db.select().from(charges);
    const first = await createCheckoutForCharges(
      groupPublicSlug,
      phone,
      [pendingCharge.id],
      "idem-url-expirada",
    );
    await db
      .update(checkoutSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(checkoutSessions.id, first.checkoutSessionId));
    expect(await expireStaleCheckoutSessions()).toEqual({
      expired: 1,
      released: 1,
      awaitingReconciliation: 0,
    });

    await expect(
      createCheckoutForCharges(groupPublicSlug, phone, [pendingCharge.id], "idem-url-expirada"),
    ).rejects.toThrow(/reconciliada/);
    await expect(
      createCheckoutForCharges(groupPublicSlug, phone, [pendingCharge.id], "idem-url-expirada-nova-chave"),
    ).rejects.toThrow(/reconciliada/);

    const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, first.checkoutSessionId));
    const [charge] = await db.select().from(charges).where(eq(charges.id, pendingCharge.id));
    expect(session.status).toBe("expired");
    expect(charge.status).toBe("open");
    expect((getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout).toHaveBeenCalledTimes(1);
  });

  it("grava webhookTokenHash (SHA-256 hex) na sessao criada", async () => {
    const pendingCharges = await db.select().from(charges);
    const result = await createCheckoutForCharges(
      groupPublicSlug,
      phone,
      [pendingCharges[0].id],
      "idem-hash-teste",
    );

    const [session] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, result.checkoutSessionId));

    expect(session.webhookTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.recoveryTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.gatewayAccountId).not.toBeNull();
    expect(session.gatewayExternalAccountIdSnapshot).toBe("handle-teste");
    expect(session.externalCreationState).toBe("linked");
  });

  it("renova hashes e snapshots antes de reviver uma falha definitivamente rejeitada", async () => {
    const [pendingCharge] = await db.select().from(charges);
    const createCheckout = (getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout;
    createCheckout.mockRejectedValueOnce(new InfinitePayCheckoutRequestError("payload rejeitado", false, 422));

    await expect(
      createCheckoutForCharges(groupPublicSlug, phone, [pendingCharge.id], "idem-revive-legado"),
    ).rejects.toThrow(/Não foi possível preparar/);
    await db
      .update(checkoutSessions)
      .set({ webhookTokenHash: null, recoveryTokenHash: null, gatewayAccountId: null, gatewayExternalAccountIdSnapshot: null })
      .where(eq(checkoutSessions.idempotencyKey, "idem-revive-legado"));

    const revived = await createCheckoutForCharges(
      groupPublicSlug,
      phone,
      [pendingCharge.id],
      "idem-revive-legado",
    );
    const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, revived.checkoutSessionId));
    expect(session.webhookTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.recoveryTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.gatewayAccountId).not.toBeNull();
    expect(session.gatewayExternalAccountIdSnapshot).toBe("handle-teste");
    expect(createCheckout).toHaveBeenCalledTimes(2);
  });

  it("envia para a InfinitePay nome e telefone do responsavel financeiro", async () => {
    const [pendingCharge] = await db.select().from(charges);
    await createCheckoutForCharges(groupPublicSlug, phone, [pendingCharge.id], "idem-payer-responsavel");

    expect((getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ buyerName: "Maria Responsável", buyerPhone: "+5511900000009" }),
    );
  });

  it("permite pagar cobranca de dependente, mas envia o responsavel como comprador", async () => {
    const [group] = await db.select().from(groups).where(eq(groups.publicSlug, groupPublicSlug));
    const dependent = await findOrCreateParticipantByPhone(organizationId, phone, "Pedro Dependente");
    await linkParticipantToGroup(organizationId, group.id, dependent.id, new Date("2026-06-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, group.id, "2026-09");
    const [dependentCharge] = await db.select().from(charges).where(eq(charges.participantId, dependent.id));

    await createCheckoutForCharges(groupPublicSlug, phone, [dependentCharge.id], "idem-dependent-payer");

    expect((getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        participantId: expect.not.stringMatching(dependent.id),
        buyerName: "Maria Responsável",
        buyerPhone: "+5511900000009",
      }),
    );
  });
});
