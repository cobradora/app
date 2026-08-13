import { db } from "@/db";
import { charges, billingPeriods, groups, participants } from "@/db/schema";
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
    .where(eq(billingPeriods.groupId, groupId));
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
    .where(and(eq(groups.organizationId, organizationId), eq(billingPeriods.referenceMonth, referenceMonth)));
}
