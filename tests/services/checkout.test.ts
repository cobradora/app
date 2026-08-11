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
import { createCheckoutForCharges } from "@/services/checkout";

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

    const participant = await findOrCreateParticipantByPhone(organizationId, phone);
    await linkParticipantToGroup(group.id, participant.id);

    await db.insert(gatewayAccounts).values({
      organizationId,
      provider: "infinitepay",
      externalAccountId: "handle-teste",
      status: "active",
    });

    await generateBillingPeriod(group.id, "2026-07");
    await generateBillingPeriod(group.id, "2026-08");
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

  it("no reuso da idempotencyKey, NAO rechama a InfinitePay (idempotencia real via checkoutUrl persistida)", async () => {
    const pendingCharges = await db.select().from(charges);
    const chargeIds = [pendingCharges[0].id];

    await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-sem-rechamada");

    const createCheckout = (getPaymentsAdapter() as unknown as { createCheckout: Mock }).createCheckout;
    expect(createCheckout).toHaveBeenCalledTimes(1);

    await createCheckoutForCharges(groupPublicSlug, phone, chargeIds, "idem-sem-rechamada");

    expect(createCheckout).toHaveBeenCalledTimes(1);
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
  });
});
