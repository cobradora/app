import { db } from "@/db";
import { participants, groupParticipants, groups } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { normalizePhoneBR } from "@/lib/phone";
import { hasOutstandingCharges } from "@/services/groups";

/**
 * Lista os participantes ativos (vinculo `group_participants.status = 'active'`)
 * de um grupo, para a tela de detalhe do grupo no dashboard. Retorna `null`
 * se o grupo nao existe ou nao pertence a organizacao.
 */
export async function listGroupParticipants(organizationId: string, groupId: string) {
  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)));
  if (!group) return null;

  return db
    .select({
      participantId: participants.id,
      name: participants.name,
      phoneDisplay: participants.phoneDisplay,
    })
    .from(groupParticipants)
    .innerJoin(participants, eq(groupParticipants.participantId, participants.id))
    .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.status, "active")));
}

export async function findOrCreateParticipantByPhone(organizationId: string, rawPhone: string) {
  const phoneNormalized = normalizePhoneBR(rawPhone);

  const [existing] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.organizationId, organizationId), eq(participants.phoneNormalized, phoneNormalized)));

  if (existing) return existing;

  const [created] = await db
    .insert(participants)
    .values({
      organizationId,
      name: "",
      phoneNormalized,
      phoneDisplay: rawPhone,
    })
    .returning();

  return created;
}

export async function linkParticipantToGroup(groupId: string, participantId: string) {
  const [link] = await db
    .insert(groupParticipants)
    .values({ groupId, participantId, status: "active" })
    .returning();
  return link;
}

export async function unlinkParticipantFromGroup(groupId: string, participantId: string) {
  if (await hasOutstandingCharges(groupId, participantId)) {
    throw new Error("Não é possível remover o participante: existem cobranças em aberto para ele neste grupo");
  }

  await db
    .update(groupParticipants)
    .set({ status: "left", leftAt: new Date() })
    .where(
      and(
        eq(groupParticipants.groupId, groupId),
        eq(groupParticipants.participantId, participantId),
        eq(groupParticipants.status, "active"),
      ),
    );
}

export const updateParticipantInput = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(8).max(30),
});

export type UpdateParticipantInput = z.infer<typeof updateParticipantInput>;

export async function updateParticipant(organizationId: string, participantId: string, rawInput: UpdateParticipantInput) {
  const input = updateParticipantInput.parse(rawInput);
  const phoneNormalized = normalizePhoneBR(input.phone);

  const [participant] = await db
    .update(participants)
    .set({ name: input.name, phoneNormalized, phoneDisplay: input.phone })
    .where(and(eq(participants.id, participantId), eq(participants.organizationId, organizationId)))
    .returning();

  return participant ?? null;
}
