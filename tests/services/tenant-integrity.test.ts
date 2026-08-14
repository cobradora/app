import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  billingPeriods,
  charges,
  checkoutSessions,
  groupParticipants,
  groups,
  organizations,
  paymentAllocations,
  payments,
} from "@/db/schema";
import { generateBillingPeriod } from "@/services/billing";
import {
  findOrCreateParticipantByPhone,
  linkParticipantToGroup,
} from "@/services/participants";
import { truncateAll } from "../helpers/db";

describe("integridade estrutural multi-tenant", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let groupId: string;

  beforeEach(async () => {
    await truncateAll();
    const [organization, otherOrganization] = await db
      .insert(organizations)
      .values([{ name: "Org A" }, { name: "Org B" }])
      .returning();
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;

    const [group] = await db
      .insert(groups)
      .values({
        organizationId,
        name: "Grupo A",
        publicSlug: "grupo-a-integridade",
        billingDay: 10,
        defaultAmount: 5000,
      })
      .returning();
    groupId = group.id;
  });

  it("impede vínculo de participante com grupo de outra organização", async () => {
    const participant = await findOrCreateParticipantByPhone(
      otherOrganizationId,
      "(21) 98888-1111",
      "Outro tenant",
    );

    await expect(
      db.insert(groupParticipants).values({
        groupId,
        participantId: participant.id,
        billingStartsOn: "2026-08-10",
        participantNameNormalized: participant.nameNormalized,
      }),
    ).rejects.toThrow();
  });

  it("impede cobrança para participante que não pertence ao tenant/grupo do ciclo", async () => {
    const participant = await findOrCreateParticipantByPhone(
      otherOrganizationId,
      "(21) 98888-2222",
      "Outro devedor",
    );
    const [period] = await db
      .insert(billingPeriods)
      .values({ groupId, referenceMonth: "2026-08", dueDate: "2026-08-10" })
      .returning();

    await expect(
      db.insert(charges).values({
        billingPeriodId: period.id,
        participantId: participant.id,
        originalAmount: 5000,
        totalAmount: 5000,
        dueDate: period.dueDate,
      }),
    ).rejects.toThrow();
  });

  it("impede sessão que combina organização, participante e contato de outro tenant", async () => {
    const participant = await findOrCreateParticipantByPhone(
      otherOrganizationId,
      "(21) 98888-3333",
      "Responsável externo",
    );

    await expect(
      db.insert(checkoutSessions).values({
        organizationId,
        participantId: participant.id,
        financialContactId: participant.financialContactId,
        gateway: "infinitepay",
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: "tenant-cross-session",
      }),
    ).rejects.toThrow();
  });

  it("impede alocar pagamento em cobrança de outro contato financeiro", async () => {
    const payer = await findOrCreateParticipantByPhone(
      organizationId,
      "(11) 98888-4444",
      "Pagador",
    );
    const debtor = await findOrCreateParticipantByPhone(
      organizationId,
      "(11) 98888-5555",
      "Outro contato",
    );
    await linkParticipantToGroup(
      organizationId,
      groupId,
      debtor.id,
      new Date("2026-08-01T12:00:00-03:00"),
    );
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    const [charge] = await db
      .select()
      .from(charges)
      .where(eq(charges.billingPeriodId, period.id));
    const [payment] = await db
      .insert(payments)
      .values({
        organizationId,
        participantId: payer.id,
        gateway: "manual",
        amount: charge.totalAmount,
        status: "confirmed",
      })
      .returning();

    await expect(
      db.insert(paymentAllocations).values({
        paymentId: payment.id,
        chargeId: charge.id,
        amount: charge.totalAmount,
      }),
    ).rejects.toThrow();
  });
});
