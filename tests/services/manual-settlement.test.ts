import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, charges, billingPeriods, auditEvents } from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { registerManualSettlement } from "@/services/manual-settlement";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

describe("manual settlement", () => {
  let organizationId: string;
  let userId: string;
  let chargeId: string;

  beforeEach(async () => {
    await truncateAll();
    const [org] = await db.insert(organizations).values({ name: "Org Teste" }).returning();
    organizationId = org.id;
    userId = "11111111-1111-1111-1111-111111111111";

    const [group] = await db
      .insert(groups)
      .values({ organizationId, name: "Beach Tennis", publicSlug: "bt-abc1", billingDay: 8, defaultAmount: 9000 })
      .returning();

    const participant = await findOrCreateParticipantByPhone(organizationId, "(21) 90000-0007");
    await linkParticipantToGroup(organizationId, group.id, participant.id, new Date("2026-08-01T12:00:00Z"));
    const period = await generateBillingPeriod(organizationId, group.id, "2026-08");

    const [charge] = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    chargeId = charge.id;
  });

  it("registra ator, metodo e observacao na auditoria (RB-011)", async () => {
    await registerManualSettlement(organizationId, userId, chargeId, {
      paymentMethod: "dinheiro",
      observation: "Pago em espécie no dia do jogo",
    });

    const [updated] = await db.select().from(charges).where(eq(charges.id, chargeId));
    expect(updated.status).toBe("manually_paid");

    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, chargeId));
    expect(audit.actorType).toBe("user");
    expect(audit.actorId).toBe(userId);
    expect((audit.metadata as Record<string, unknown>).observation).toBe("Pago em espécie no dia do jogo");
    expect((audit.metadata as Record<string, unknown>).paymentMethod).toBe("dinheiro");
  });

  it("aceita pix como forma de pagamento", async () => {
    await registerManualSettlement(organizationId, userId, chargeId, { paymentMethod: "pix" });

    const [updated] = await db.select().from(charges).where(eq(charges.id, chargeId));
    expect(updated.status).toBe("manually_paid");
  });

  it("rejeita 'transferencia' (removida em favor de pix/outro)", async () => {
    await expect(
      registerManualSettlement(organizationId, userId, chargeId, {
        // @ts-expect-error valor antigo, removido do enum
        paymentMethod: "transferencia",
      }),
    ).rejects.toThrow();
  });
});
