import { db } from "@/db";
import {
  charges,
  billingPeriods,
  groups,
  participants,
  payments,
  paymentAllocations,
  auditEvents,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const manualSettlementInput = z.object({
  paymentMethod: z.enum(["dinheiro", "pix", "outro"]),
  observation: z.string().max(500).optional(),
});

export type ManualSettlementInput = z.infer<typeof manualSettlementInput>;

export async function registerManualSettlement(
  organizationId: string,
  actorUserId: string,
  chargeId: string,
  rawInput: ManualSettlementInput,
) {
  const input = manualSettlementInput.parse(rawInput);

  await db.transaction(async (tx) => {
    const [charge] = await tx
      .select({
        id: charges.id,
        participantId: charges.participantId,
        totalAmount: charges.totalAmount,
      })
      .from(charges)
      .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
      .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
      .innerJoin(participants, eq(charges.participantId, participants.id))
      .where(
        and(
          eq(charges.id, chargeId),
          eq(charges.status, "open"),
          eq(groups.organizationId, organizationId),
          eq(participants.organizationId, organizationId),
        ),
      )
      .for("update");
    if (!charge) {
      throw new Error("Cobrança não encontrada ou indisponível para baixa manual");
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        organizationId,
        participantId: charge.participantId,
        gateway: "manual",
        amount: charge.totalAmount,
        status: "confirmed",
        paidAt: new Date(),
        paymentMethod: input.paymentMethod,
      })
      .returning();

    await tx.insert(paymentAllocations).values({
      paymentId: payment.id,
      chargeId: charge.id,
      amount: charge.totalAmount,
    });

    const updated = await tx
      .update(charges)
      .set({ status: "manually_paid", updatedAt: new Date() })
      .where(and(eq(charges.id, charge.id), eq(charges.status, "open")))
      .returning({ id: charges.id });
    if (updated.length !== 1) {
      throw new Error("Cobrança alterada por outra operação; tente novamente");
    }

    await tx.insert(auditEvents).values({
      organizationId,
      entityType: "charge",
      entityId: charge.id,
      action: "manual_settlement",
      actorType: "user",
      actorId: actorUserId,
      metadata: {
        paymentMethod: input.paymentMethod,
        observation: input.observation ?? null,
        amount: charge.totalAmount,
      },
    });
  });
}
