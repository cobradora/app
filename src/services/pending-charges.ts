import { db } from "@/db";
import { charges, billingPeriods, groups, participants, financialContacts } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { normalizePhoneBR } from "@/lib/phone";

/**
 * A resposta vazia é deliberadamente uniforme para grupo/telefone ausente ou
 * inválido. A rota pública não revela qual parte da identificação falhou.
 */
export async function listPendingChargesByPhone(groupPublicSlug: string, rawPhone: string) {
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.publicSlug, groupPublicSlug), eq(groups.status, "active")));
  if (!group) return [];

  let phoneNormalized: string;
  try {
    phoneNormalized = normalizePhoneBR(rawPhone);
  } catch {
    return [];
  }

  const [financialContact] = await db
    .select()
    .from(financialContacts)
    .where(
      and(
        eq(financialContacts.organizationId, group.organizationId),
        eq(financialContacts.phoneNormalized, phoneNormalized),
      ),
    );
  if (!financialContact) return [];

  const [responsible] = await db
    .select({ name: participants.name })
    .from(participants)
    .where(
      and(
        eq(participants.organizationId, group.organizationId),
        eq(participants.financialContactId, financialContact.id),
        eq(participants.financialRole, "responsible"),
      ),
    );
  if (!responsible) return [];

  return db
    .select({
      chargeId: charges.id,
      participantId: participants.id,
      participantName: participants.name,
      payerName: participants.name,
      totalAmount: charges.totalAmount,
      dueDate: charges.dueDate,
      referenceMonth: billingPeriods.referenceMonth,
    })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .where(
      and(
        eq(billingPeriods.groupId, group.id),
        eq(participants.organizationId, group.organizationId),
        eq(participants.financialContactId, financialContact.id),
        inArray(charges.status, ["open", "checkout_pending"]),
      ),
    )
    .orderBy(asc(billingPeriods.referenceMonth), asc(participants.name))
    .then((rows) => rows.map((row) => ({ ...row, payerName: responsible.name })));
}
