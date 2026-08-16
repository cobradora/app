import { db } from "@/db";
import { groups, charges, billingPeriods, participants } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { cleanHumanName, GROUP_NAME_MAX_LENGTH } from "@/lib/normalization";

const groupName = z
  .string()
  .max(GROUP_NAME_MAX_LENGTH)
  .transform(cleanHumanName)
  .refine((value) => value.length > 0, "Informe o nome do grupo");

const MESSAGE_PART_MAX_LENGTH = 1000;
const messagePart = z.string().max(MESSAGE_PART_MAX_LENGTH).transform((value) => value.trim());

export const createGroupInput = z.object({
  name: groupName,
  sport: z.string().min(1).max(60).optional(),
  // Vazio/ausente = renovação manual (sem cron automático para este grupo).
  billingDay: z.number().int().min(1).max(28).nullable().optional(),
  defaultAmount: z.number().int().positive(),
});

export type CreateGroupInput = z.infer<typeof createGroupInput>;

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createGroup(organizationId: string, rawInput: CreateGroupInput) {
  const input = createGroupInput.parse(rawInput);
  const baseSlug = slugify(input.name).slice(0, 70) || "grupo";
  const suffix = randomBytes(12).toString("base64url");

  const [group] = await db
    .insert(groups)
    .values({
      organizationId,
      name: input.name,
      publicSlug: `${baseSlug}-${suffix}`,
      billingDay: input.billingDay ?? null,
      defaultAmount: input.defaultAmount,
    })
    .returning();

  return group;
}

export async function listGroups(organizationId: string) {
  return db.select().from(groups).where(eq(groups.organizationId, organizationId));
}

export const updateGroupInput = z.object({
  name: groupName.optional(),
  // `null` limpa o dia (volta pra renovação manual); `undefined`/ausente
  // deixa o valor atual intacto.
  billingDay: z.number().int().min(1).max(28).nullable().optional(),
  defaultAmount: z.number().int().positive().optional(),
  messageIntro: messagePart.optional(),
  messageOutro: messagePart.optional(),
  messageParticipantFilter: z.enum(["all", "paid", "pending"]).optional(),
}).refine((input) => Object.values(input).some((value) => value !== undefined), "Informe ao menos um campo");

export type UpdateGroupInput = z.infer<typeof updateGroupInput>;

export async function updateGroup(organizationId: string, groupId: string, rawInput: UpdateGroupInput) {
  const input = updateGroupInput.parse(rawInput);
  const changes = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.billingDay !== undefined && { billingDay: input.billingDay }),
    ...(input.defaultAmount !== undefined && { defaultAmount: input.defaultAmount }),
    ...(input.messageIntro !== undefined && { messageIntro: input.messageIntro }),
    ...(input.messageOutro !== undefined && { messageOutro: input.messageOutro }),
    ...(input.messageParticipantFilter !== undefined && { messageParticipantFilter: input.messageParticipantFilter }),
  };

  const [group] = await db
    .update(groups)
    .set(changes)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)))
    .returning();

  return group ?? null;
}

/**
 * Verifica se ha cobrancas em aberto (open/checkout_pending) no grupo — e,
 * opcionalmente, restritas a um participante especifico — para bloquear
 * arquivamento de grupo / remocao de participante com saldo pendente.
 */
export async function hasOutstandingCharges(
  organizationId: string,
  groupId: string,
  participantId?: string,
): Promise<boolean> {
  const conditions = [
    eq(groups.organizationId, organizationId),
    eq(participants.organizationId, organizationId),
    eq(billingPeriods.groupId, groupId),
    inArray(charges.status, ["open", "checkout_pending"]),
  ];
  if (participantId) conditions.push(eq(charges.participantId, participantId));

  const [row] = await db
    .select({ id: charges.id })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .where(and(...conditions))
    .limit(1);

  return Boolean(row);
}

export async function archiveGroup(organizationId: string, groupId: string) {
  const [existing] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)));
  if (!existing) return null;

  if (await hasOutstandingCharges(organizationId, groupId)) {
    throw new Error("Não é possível arquivar o grupo: existem cobranças em aberto");
  }

  const [group] = await db
    .update(groups)
    .set({ status: "archived" })
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)))
    .returning();

  return group;
}

/**
 * Dado minimo e publico de um grupo, para a pagina publica de checkout
 * (`/g/[publicSlug]`) mostrar o nome antes do participante informar o
 * telefone. Nunca inclui `id`, `organizationId` ou dados de configuracao
 * (billingDay, defaultAmount) — isso e' informacao interna do organizador.
 */
export async function getGroupPublicSummary(publicSlug: string): Promise<{ name: string; status: "active" | "archived" } | null> {
  const [group] = await db
    .select({ name: groups.name, status: groups.status })
    .from(groups)
    .where(eq(groups.publicSlug, publicSlug));

  return group ?? null;
}
