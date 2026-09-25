import { db } from "@/db";
import { charges, billingPeriods, groups, participants, financialContacts } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { normalizePhone } from "@/lib/phone";

// A migration 0004 precisou criar este placeholder para cadastros legados
// cujo nome estava vazio. O UUID é técnico e nunca deve chegar à tela pública.
function isGeneratedParticipantName(name: string): boolean {
  return /^Participante[ -]+[a-z0-9-]{8,}$/i.test(name.trim());
}

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
    phoneNormalized = normalizePhone(rawPhone);
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

  const contactParticipants = await db
    .select({ name: participants.name, financialRole: participants.financialRole })
    .from(participants)
    .where(
      and(
        eq(participants.organizationId, group.organizationId),
        eq(participants.financialContactId, financialContact.id),
      ),
    );
  const responsible = contactParticipants.find((participant) => participant.financialRole === "responsible");
  if (!responsible) return [];

  const meaningfulNames = [...new Set(
    contactParticipants
      .map((participant) => participant.name.trim())
      .filter((name) => name && !isGeneratedParticipantName(name)),
  )];
  const placeholderFallback = meaningfulNames.length === 1 ? meaningfulNames[0] : null;
  const payerName = isGeneratedParticipantName(responsible.name)
    ? placeholderFallback ?? "Responsável financeiro"
    : responsible.name;

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
    .then((rows) => rows.map((row) => ({
      ...row,
      participantName: isGeneratedParticipantName(row.participantName)
        ? placeholderFallback ?? "Participante"
        : row.participantName,
      payerName,
    })));
}
