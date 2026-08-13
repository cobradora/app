import { db } from "@/db";
import { groups, charges, billingPeriods } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const createGroupInput = z.object({
  name: z.string().min(1).max(200),
  sport: z.string().min(1).max(60).optional(),
  billingDay: z.number().int().min(1).max(28),
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
  const baseSlug = slugify(input.name);
  const suffix = Math.random().toString(36).slice(2, 6);

  const [group] = await db
    .insert(groups)
    .values({
      organizationId,
      name: input.name,
      publicSlug: `${baseSlug}-${suffix}`,
      billingDay: input.billingDay,
      defaultAmount: input.defaultAmount,
    })
    .returning();

  return group;
}

export async function listGroups(organizationId: string) {
  return db.select().from(groups).where(eq(groups.organizationId, organizationId));
}

export const updateGroupInput = z.object({
  name: z.string().min(1).max(200),
});

export type UpdateGroupInput = z.infer<typeof updateGroupInput>;

export async function updateGroup(organizationId: string, groupId: string, rawInput: UpdateGroupInput) {
  const input = updateGroupInput.parse(rawInput);

  const [group] = await db
    .update(groups)
    .set({ name: input.name })
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)))
    .returning();

  return group ?? null;
}

/**
 * Verifica se ha cobrancas em aberto (open/checkout_pending) no grupo — e,
 * opcionalmente, restritas a um participante especifico — para bloquear
 * arquivamento de grupo / remocao de participante com saldo pendente.
 */
export async function hasOutstandingCharges(groupId: string, participantId?: string): Promise<boolean> {
  const conditions = [eq(billingPeriods.groupId, groupId), inArray(charges.status, ["open", "checkout_pending"])];
  if (participantId) conditions.push(eq(charges.participantId, participantId));

  const [row] = await db
    .select({ id: charges.id })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
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

  if (await hasOutstandingCharges(groupId)) {
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
