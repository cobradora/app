import { db } from "@/db";
import {
  participants,
  financialContacts,
  groupParticipants,
  billingPeriods,
  groups,
  checkoutSessions,
  checkoutItems,
  charges,
} from "@/db/schema";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { parsePhoneBR, PHONE_INPUT_MAX_LENGTH } from "@/lib/phone";
import {
  cleanHumanName,
  normalizeHumanName,
  PARTICIPANT_NAME_MAX_LENGTH,
} from "@/lib/normalization";
import { billingStartFor, currentReferenceMonth } from "@/lib/billing-cycle";
import { hasOutstandingCharges } from "@/services/groups";

type TransactionClient = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export class ParticipantNameConflictError extends Error {
  constructor() {
    super("Já existe um participante com esse nome neste grupo");
    this.name = "ParticipantNameConflictError";
  }
}

export class ParticipantCheckoutInProgressError extends Error {
  constructor() {
    super("Não é possível alterar o telefone enquanto houver checkout em andamento para este contato");
    this.name = "ParticipantCheckoutInProgressError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

const validPhone = (value: string) => {
  try {
    parsePhoneBR(value);
    return true;
  } catch {
    return false;
  }
};

const participantFields = z.object({
  name: z
    .string()
    .max(PARTICIPANT_NAME_MAX_LENGTH)
    .transform(cleanHumanName)
    .refine((value) => value.length > 0, "Informe o nome do participante"),
  phone: z
    .string()
    .max(PHONE_INPUT_MAX_LENGTH)
    .refine(validPhone, "Informe um celular brasileiro válido com DDD"),
});

/** R$ 1.000.000,00 em centavos: teto defensivo para entrada administrativa. */
export const MAX_PARTICIPANT_BILLING_AMOUNT = 100_000_000;

const participantBillingAmount = z
  .number()
  .int("O valor deve ser informado em centavos")
  .min(1, "O valor da cobrança deve ser maior que zero")
  .max(MAX_PARTICIPANT_BILLING_AMOUNT, "O valor da cobrança excede o limite permitido");

export const addParticipantInput = participantFields.extend({
  billingAmount: participantBillingAmount.optional(),
});
export const updateParticipantInput = participantFields;
export const updateGroupParticipantBillingInput = z.object({
  billingAmount: participantBillingAmount,
});

export type AddParticipantInput = z.infer<typeof addParticipantInput>;
export type UpdateParticipantInput = z.infer<typeof updateParticipantInput>;
export type UpdateGroupParticipantBillingInput = z.infer<typeof updateGroupParticipantBillingInput>;

export class ParticipantBillingCheckoutPendingError extends Error {
  constructor() {
    super("Não é possível alterar o valor enquanto houver checkout em andamento para este participante no grupo");
    this.name = "ParticipantBillingCheckoutPendingError";
  }
}

async function upsertFinancialContact(
  tx: TransactionClient,
  organizationId: string,
  rawPhone: string,
) {
  const phone = parsePhoneBR(rawPhone);
  const [contact] = await tx
    .insert(financialContacts)
    .values({
      organizationId,
      phoneNormalized: phone.normalized,
      phoneDisplay: phone.display,
    })
    .onConflictDoUpdate({
      target: [financialContacts.organizationId, financialContacts.phoneNormalized],
      set: { phoneDisplay: phone.display, updatedAt: new Date() },
    })
    .returning();

  return contact;
}

async function lockContacts(tx: TransactionClient, contactIds: string[]) {
  const ids = [...new Set(contactIds)].sort();
  if (ids.length === 0) return;
  await tx.execute(sql`select id from financial_contacts where id in ${ids} order by id for update`);
}

async function nextFinancialRole(tx: TransactionClient, financialContactId: string) {
  const [responsible] = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.financialContactId, financialContactId),
        eq(participants.financialRole, "responsible"),
      ),
    )
    .limit(1);
  return responsible ? ("dependent" as const) : ("responsible" as const);
}

async function groupAndBillingStart(
  tx: TransactionClient,
  organizationId: string,
  groupId: string,
  now: Date,
) {
  const [group] = await tx
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, groupId),
        eq(groups.organizationId, organizationId),
        eq(groups.status, "active"),
      ),
    );
  if (!group) return null;

  const referenceMonth = currentReferenceMonth(now);
  const [currentPeriod] = await tx
    .select({ id: billingPeriods.id })
    .from(billingPeriods)
    .where(
      and(
        eq(billingPeriods.groupId, groupId),
        eq(billingPeriods.referenceMonth, referenceMonth),
      ),
    )
    .limit(1);

  return {
    group,
    ...billingStartFor(group.billingDay, now, Boolean(currentPeriod)),
  };
}

async function assertNameAvailable(
  tx: TransactionClient,
  groupId: string,
  nameNormalized: string,
  exceptParticipantId?: string,
) {
  const conditions = [
    eq(groupParticipants.groupId, groupId),
    eq(groupParticipants.participantNameNormalized, nameNormalized),
    eq(groupParticipants.status, "active"),
  ];
  if (exceptParticipantId) conditions.push(ne(groupParticipants.participantId, exceptParticipantId));

  const [duplicate] = await tx
    .select({ id: groupParticipants.id })
    .from(groupParticipants)
    .where(and(...conditions))
    .limit(1);
  if (duplicate) throw new ParticipantNameConflictError();
}

/** Lista os participantes ativos de um grupo tenant-scoped. */
export async function listGroupParticipants(organizationId: string, groupId: string) {
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)));
  if (!group) return null;

  return db
    .select({
      participantId: participants.id,
      financialContactId: participants.financialContactId,
      financialRole: participants.financialRole,
      name: participants.name,
      phoneDisplay: financialContacts.phoneDisplay,
      billingStartsOn: groupParticipants.billingStartsOn,
      billingAmount: groupParticipants.billingAmount,
    })
    .from(groupParticipants)
    .innerJoin(participants, eq(groupParticipants.participantId, participants.id))
    .innerJoin(financialContacts, eq(participants.financialContactId, financialContacts.id))
    .where(
      and(
        eq(groupParticipants.groupId, groupId),
        eq(groupParticipants.status, "active"),
        eq(participants.organizationId, organizationId),
        eq(financialContacts.organizationId, organizationId),
      ),
    );
}

/**
 * Compatibilidade para seeds/testes de baixo nível. Apesar do nome legado,
 * cada chamada cria um devedor separado e apenas reaproveita o contato.
 */
export async function findOrCreateParticipantByPhone(
  organizationId: string,
  rawPhone: string,
  name?: string,
) {
  const phone = parsePhoneBR(rawPhone);
  const parsed = participantFields.parse({ name: name ?? `Participante ${phone.normalized.slice(-4)}`, phone: rawPhone });
  const nameNormalized = normalizeHumanName(parsed.name);

  return db.transaction(async (tx) => {
    const contact = await upsertFinancialContact(tx, organizationId, parsed.phone);
    await lockContacts(tx, [contact.id]);
    const financialRole = await nextFinancialRole(tx, contact.id);
    const [participant] = await tx
      .insert(participants)
      .values({
        organizationId,
        financialContactId: contact.id,
        name: parsed.name,
        nameNormalized,
        financialRole,
      })
      .returning();

    return {
      ...participant,
      phoneNormalized: contact.phoneNormalized,
      phoneDisplay: contact.phoneDisplay,
    };
  });
}

export async function addParticipantToGroup(
  organizationId: string,
  groupId: string,
  rawInput: AddParticipantInput,
  now = new Date(),
) {
  const input = addParticipantInput.parse(rawInput);
  const nameNormalized = normalizeHumanName(input.name);

  try {
    return await db.transaction(async (tx) => {
      const cycle = await groupAndBillingStart(tx, organizationId, groupId, now);
      if (!cycle) return null;
      await assertNameAvailable(tx, groupId, nameNormalized);

      const contact = await upsertFinancialContact(tx, organizationId, input.phone);
      await lockContacts(tx, [contact.id]);
      const financialRole = await nextFinancialRole(tx, contact.id);
      const [participant] = await tx
        .insert(participants)
        .values({
          organizationId,
          financialContactId: contact.id,
          name: input.name,
          nameNormalized,
          financialRole,
        })
        .returning();

      await tx.insert(groupParticipants).values({
        groupId,
        participantId: participant.id,
        billingAmount: input.billingAmount ?? cycle.group.defaultAmount,
        joinedAt: now,
        billingStartsOn: cycle.billingStartsOn,
        participantNameNormalized: nameNormalized,
        status: "active",
      });

      return {
        participant: {
          ...participant,
          phoneNormalized: contact.phoneNormalized,
          phoneDisplay: contact.phoneDisplay,
        },
        startsNextCycle: cycle.startsNextCycle,
        nextCycleReferenceMonth: cycle.referenceMonth,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ParticipantNameConflictError();
    throw error;
  }
}

export async function linkParticipantToGroup(
  organizationId: string,
  groupId: string,
  participantId: string,
  now = new Date(),
) {
  try {
    return await db.transaction(async (tx) => {
      const cycle = await groupAndBillingStart(tx, organizationId, groupId, now);
      if (!cycle) return null;

      const [participant] = await tx
        .select()
        .from(participants)
        .where(and(eq(participants.id, participantId), eq(participants.organizationId, organizationId)));
      if (!participant) return null;

      await assertNameAvailable(tx, groupId, participant.nameNormalized, participant.id);
      const [link] = await tx
        .insert(groupParticipants)
        .values({
          groupId,
          participantId,
          billingAmount: cycle.group.defaultAmount,
          joinedAt: now,
          billingStartsOn: cycle.billingStartsOn,
          participantNameNormalized: participant.nameNormalized,
          status: "active",
        })
        .returning();
      return link;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ParticipantNameConflictError();
    throw error;
  }
}

/**
 * Atualiza o valor do participante apenas no grupo informado. A mesma
 * transação recalcula cobranças ainda abertas; cobranças históricas nunca
 * são reescritas e uma reserva de checkout bloqueia toda a operação.
 */
export async function updateGroupParticipantBillingAmount(
  organizationId: string,
  groupId: string,
  participantId: string,
  rawInput: UpdateGroupParticipantBillingInput,
) {
  const input = updateGroupParticipantBillingInput.parse(rawInput);

  return db.transaction(async (tx) => {
    // Serializa edições do mesmo vínculo e garante o tenant antes de ler
    // ou alterar qualquer valor.
    await tx.execute(sql`
      select gp.id
      from group_participants gp
      inner join groups g on g.id = gp.group_id
      inner join participants p on p.id = gp.participant_id
      where gp.group_id = ${groupId}
        and gp.participant_id = ${participantId}
        and gp.status = 'active'
        and g.organization_id = ${organizationId}
        and p.organization_id = ${organizationId}
      for update of gp
    `);

    const [membership] = await tx
      .select({ id: groupParticipants.id })
      .from(groupParticipants)
      .innerJoin(groups, eq(groupParticipants.groupId, groups.id))
      .innerJoin(participants, eq(groupParticipants.participantId, participants.id))
      .where(
        and(
          eq(groupParticipants.groupId, groupId),
          eq(groupParticipants.participantId, participantId),
          eq(groupParticipants.status, "active"),
          eq(groups.organizationId, organizationId),
          eq(participants.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!membership) return null;

    // O lock das cobranças coordena esta edição com a reserva atômica
    // feita pelo checkout (open -> checkout_pending).
    await tx.execute(sql`
      select c.id
      from charges c
      inner join billing_periods bp on bp.id = c.billing_period_id
      inner join groups g on g.id = bp.group_id
      where bp.group_id = ${groupId}
        and c.participant_id = ${participantId}
        and c.status in ('open', 'checkout_pending')
        and g.organization_id = ${organizationId}
      order by c.id
      for update of c
    `);

    const currentCharges = await tx
      .select({ id: charges.id, status: charges.status })
      .from(charges)
      .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
      .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
      .where(
        and(
          eq(billingPeriods.groupId, groupId),
          eq(charges.participantId, participantId),
          inArray(charges.status, ["open", "checkout_pending"]),
          eq(groups.organizationId, organizationId),
        ),
      );

    if (currentCharges.some((charge) => charge.status === "checkout_pending")) {
      throw new ParticipantBillingCheckoutPendingError();
    }

    const openChargeIds = currentCharges.map((charge) => charge.id);
    let updatedOpenCharges = 0;
    if (openChargeIds.length > 0) {
      const updated = await tx
        .update(charges)
        .set({
          originalAmount: input.billingAmount,
          totalAmount: sql`${input.billingAmount} - ${charges.discountAmount} + ${charges.fineAmount} + ${charges.interestAmount}`,
          updatedAt: new Date(),
        })
        .where(and(inArray(charges.id, openChargeIds), eq(charges.status, "open")))
        .returning({ id: charges.id });
      updatedOpenCharges = updated.length;
    }

    const [updatedMembership] = await tx
      .update(groupParticipants)
      .set({ billingAmount: input.billingAmount })
      .where(and(eq(groupParticipants.id, membership.id), eq(groupParticipants.status, "active")))
      .returning({
        participantId: groupParticipants.participantId,
        billingAmount: groupParticipants.billingAmount,
      });

    if (!updatedMembership) return null;
    return { participant: updatedMembership, updatedOpenCharges };
  });
}

export async function unlinkParticipantFromGroup(
  organizationId: string,
  groupId: string,
  participantId: string,
) {
  const [ownedLink] = await db
    .select({ id: groupParticipants.id })
    .from(groupParticipants)
    .innerJoin(groups, eq(groupParticipants.groupId, groups.id))
    .innerJoin(participants, eq(groupParticipants.participantId, participants.id))
    .where(
      and(
        eq(groupParticipants.groupId, groupId),
        eq(groupParticipants.participantId, participantId),
        eq(groupParticipants.status, "active"),
        eq(groups.organizationId, organizationId),
        eq(participants.organizationId, organizationId),
      ),
    );
  if (!ownedLink) return null;

  if (await hasOutstandingCharges(organizationId, groupId, participantId)) {
    throw new Error("Não é possível remover o participante: existem cobranças em aberto para ele neste grupo");
  }

  const [link] = await db
    .update(groupParticipants)
    .set({ status: "left", leftAt: new Date() })
    .where(eq(groupParticipants.id, ownedLink.id))
    .returning();
  return link ?? null;
}

export async function updateParticipant(
  organizationId: string,
  participantId: string,
  rawInput: UpdateParticipantInput,
) {
  const input = updateParticipantInput.parse(rawInput);
  const phone = parsePhoneBR(input.phone);
  const nameNormalized = normalizeHumanName(input.name);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select id from participants where id = ${participantId} for update`);
      const [current] = await tx
        .select({
          id: participants.id,
          financialContactId: participants.financialContactId,
          financialRole: participants.financialRole,
          phoneNormalized: financialContacts.phoneNormalized,
        })
        .from(participants)
        .innerJoin(financialContacts, eq(participants.financialContactId, financialContacts.id))
        .where(and(eq(participants.id, participantId), eq(participants.organizationId, organizationId)));
      if (!current) return null;

      const activeLinks = await tx
        .select({ groupId: groupParticipants.groupId })
        .from(groupParticipants)
        .innerJoin(groups, eq(groupParticipants.groupId, groups.id))
        .where(
          and(
            eq(groupParticipants.participantId, participantId),
            eq(groupParticipants.status, "active"),
            eq(groups.organizationId, organizationId),
          ),
        );
      if (activeLinks.length > 0) {
        const [duplicate] = await tx
          .select({ id: groupParticipants.id })
          .from(groupParticipants)
          .where(
            and(
              inArray(groupParticipants.groupId, activeLinks.map((link) => link.groupId)),
              eq(groupParticipants.participantNameNormalized, nameNormalized),
              eq(groupParticipants.status, "active"),
              ne(groupParticipants.participantId, participantId),
            ),
          )
          .limit(1);
        if (duplicate) throw new ParticipantNameConflictError();
      }

      if (phone.normalized !== current.phoneNormalized) {
        const [activeCheckout] = await tx
          .select({ id: checkoutSessions.id })
          .from(checkoutSessions)
          .leftJoin(checkoutItems, eq(checkoutItems.checkoutSessionId, checkoutSessions.id))
          .leftJoin(charges, eq(charges.id, checkoutItems.chargeId))
          .where(
            and(
              eq(checkoutSessions.organizationId, organizationId),
              inArray(checkoutSessions.status, ["created", "pending"]),
              or(
                eq(checkoutSessions.financialContactId, current.financialContactId),
                eq(charges.participantId, participantId),
              ),
            ),
          )
          .limit(1);
        if (activeCheckout) throw new ParticipantCheckoutInProgressError();
      }

      const targetContact = await upsertFinancialContact(tx, organizationId, phone.normalized);
      await lockContacts(tx, [current.financialContactId, targetContact.id]);

      let financialRole = current.financialRole;
      const movedContact = targetContact.id !== current.financialContactId;
      if (movedContact) {
        financialRole = await nextFinancialRole(tx, targetContact.id);
      }

      const [updated] = await tx
        .update(participants)
        .set({
          name: input.name,
          nameNormalized,
          financialContactId: targetContact.id,
          financialRole,
        })
        .where(and(eq(participants.id, participantId), eq(participants.organizationId, organizationId)))
        .returning();

      if (movedContact && current.financialRole === "responsible") {
        const [successor] = await tx
          .select({ id: participants.id })
          .from(participants)
          .where(
            and(
              eq(participants.financialContactId, current.financialContactId),
              eq(participants.financialRole, "dependent"),
            ),
          )
          .orderBy(asc(participants.createdAt), asc(participants.id))
          .limit(1);
        if (successor) {
          await tx
            .update(participants)
            .set({ financialRole: "responsible" })
            .where(eq(participants.id, successor.id));
        }
      }

      return {
        ...updated,
        phoneNormalized: targetContact.phoneNormalized,
        phoneDisplay: targetContact.phoneDisplay,
      };
    });
  } catch (error) {
    if (error instanceof ParticipantNameConflictError) throw error;
    if (isUniqueViolation(error)) throw new ParticipantNameConflictError();
    throw error;
  }
}
