import { db } from "@/db";
import { charges, payments, paymentAllocations, auditEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const manualSettlementInput = z.object({
  paymentMethod: z.enum(["dinheiro", "transferencia", "outro"]),
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

  const [charge] = await db.select().from(charges).where(eq(charges.id, chargeId));
  if (!charge) throw new Error("Cobrança não encontrada");
  if (charge.status === "paid" || charge.status === "manually_paid") {
    throw new Error("Cobrança já está paga — use um evento de estorno para corrigir, não uma nova baixa");
  }

  await db.transaction(async (tx) => {
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

    await tx
      .update(charges)
      .set({ status: "manually_paid", updatedAt: new Date() })
      .where(eq(charges.id, charge.id));

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
