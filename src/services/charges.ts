import { db } from "@/db";
import { charges, billingPeriods, groups, participants, auditEvents } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Lista todas as cobrancas reais de um grupo (todos os periodos gerados),
 * com nome do participante ja resolvido, para a tela de detalhe do grupo no
 * dashboard. Retorna `null` se o grupo nao existe ou nao pertence a
 * organizacao (o caller trata como 404).
 */
export async function listGroupCharges(organizationId: string, groupId: string) {
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)));
  if (!group) return null;

  return db
    .select({
      chargeId: charges.id,
      participantId: charges.participantId,
      participantName: participants.name,
      totalAmount: charges.totalAmount,
      status: charges.status,
      referenceMonth: billingPeriods.referenceMonth,
      dueDate: charges.dueDate,
    })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .where(
      and(
        eq(billingPeriods.groupId, groupId),
        eq(participants.organizationId, organizationId),
      ),
    );
}

/**
 * Lista todas as cobrancas reais da organizacao inteira (todos os grupos)
 * para um mes de referencia especifico, com nome do participante e do grupo
 * ja resolvidos — usada pelas telas "Visao Geral" e "Cobranca" do dashboard.
 */
export async function listOrganizationCharges(organizationId: string, referenceMonth: string) {
  return db
    .select({
      chargeId: charges.id,
      groupId: groups.id,
      groupName: groups.name,
      participantId: charges.participantId,
      participantName: participants.name,
      totalAmount: charges.totalAmount,
      status: charges.status,
      referenceMonth: billingPeriods.referenceMonth,
      dueDate: charges.dueDate,
    })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .where(
      and(
        eq(groups.organizationId, organizationId),
        eq(participants.organizationId, organizationId),
        eq(billingPeriods.referenceMonth, referenceMonth),
      ),
    );
}

/**
 * Cancela uma cobrança em aberto (nunca uma já paga ou em checkout) — não
 * mexe em payments/paymentAllocations, só marca a charge como `canceled`
 * (RB-012: pagamento confirmado não é apagado, e cancelamento não é baixa).
 */
export async function cancelCharge(organizationId: string, actorUserId: string, chargeId: string) {
  return db.transaction(async (tx) => {
    const [charge] = await tx
      .select({ id: charges.id })
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
      throw new Error("Cobrança não encontrada ou indisponível para cancelamento");
    }

    const updated = await tx
      .update(charges)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(and(eq(charges.id, charge.id), eq(charges.status, "open")))
      .returning({ id: charges.id });
    if (updated.length !== 1) {
      throw new Error("Cobrança alterada por outra operação; tente novamente");
    }

    await tx.insert(auditEvents).values({
      organizationId,
      entityType: "charge",
      entityId: charge.id,
      action: "charge_canceled",
      actorType: "user",
      actorId: actorUserId,
      metadata: null,
    });
  });
}
