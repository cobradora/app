import { db } from "@/db";
import { organizationSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MESSAGE_PART_MAX_LENGTH } from "@/lib/normalization";

const messagePart = z.string().max(MESSAGE_PART_MAX_LENGTH).transform((value) => value.trim());

export const updateOrganizationSettingsInput = z
  .object({
    messageIntro: messagePart.optional(),
    messageOutro: messagePart.optional(),
    messageParticipantFilter: z.enum(["all", "paid", "pending"]).optional(),
  })
  .refine(
    (value) =>
      value.messageIntro !== undefined ||
      value.messageOutro !== undefined ||
      value.messageParticipantFilter !== undefined,
    "Informe ao menos um campo",
  );

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsInput>;

export async function getOrganizationSettings(organizationId: string) {
  const [settings] = await db
    .insert(organizationSettings)
    .values({ organizationId })
    .onConflictDoNothing({ target: organizationSettings.organizationId })
    .returning();
  if (settings) return settings;

  const [existing] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, organizationId));
  if (!existing) throw new Error("Configurações da organização não encontradas");
  return existing;
}

export async function updateOrganizationSettings(
  organizationId: string,
  rawInput: UpdateOrganizationSettingsInput,
) {
  const input = updateOrganizationSettingsInput.parse(rawInput);
  const [settings] = await db
    .insert(organizationSettings)
    .values({
      organizationId,
      messageIntro: input.messageIntro ?? "",
      messageOutro: input.messageOutro ?? "",
      messageParticipantFilter: input.messageParticipantFilter ?? "all",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: organizationSettings.organizationId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return settings;
}
