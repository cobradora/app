import { db } from "@/db";
import { auditEvents, organizations } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { parsePhoneBR, PHONE_INPUT_MAX_LENGTH } from "@/lib/phone";

function isValidPhone(value: string): boolean {
  try {
    parsePhoneBR(value);
    return true;
  } catch {
    return false;
  }
}

const organizerPhoneInput = z
  .string()
  .max(PHONE_INPUT_MAX_LENGTH)
  .refine(isValidPhone, "Informe um celular brasileiro válido com DDD");

export const billingModuleSettingsInput = z
  .object({
    billingModule: z.enum(["dora", "cobradora"]),
    organizerPhone: organizerPhoneInput.nullable().optional(),
  })
  .strict();

export type BillingModuleSettingsInput = z.infer<typeof billingModuleSettingsInput>;

export class OrganizerPhoneRequiredError extends Error {
  constructor() {
    super("Informe o WhatsApp do organizador para usar o módulo CobraDora");
    this.name = "OrganizerPhoneRequiredError";
  }
}

function publicSettings(organization: typeof organizations.$inferSelect) {
  return {
    billingModule: organization.billingModule,
    organizerPhone: organization.organizerPhoneDisplay,
    organizerPhoneNormalized: organization.organizerPhoneNormalized,
  };
}

export async function getBillingModuleSettings(organizationId: string) {
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  return organization ? publicSettings(organization) : null;
}

export async function updateBillingModuleSettings(
  organizationId: string,
  actorUserId: string,
  rawInput: BillingModuleSettingsInput,
) {
  const input = billingModuleSettingsInput.parse(rawInput);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from organizations where id = ${organizationId} for update`);
    const [current] = await tx.select().from(organizations).where(eq(organizations.id, organizationId));
    if (!current) return null;

    let organizerPhoneNormalized = current.organizerPhoneNormalized;
    let organizerPhoneDisplay = current.organizerPhoneDisplay;
    if (input.organizerPhone !== undefined) {
      if (input.organizerPhone === null) {
        organizerPhoneNormalized = null;
        organizerPhoneDisplay = null;
      } else {
        const parsed = parsePhoneBR(input.organizerPhone);
        organizerPhoneNormalized = parsed.normalized;
        organizerPhoneDisplay = parsed.display;
      }
    }

    if (input.billingModule === "cobradora" && !organizerPhoneNormalized) {
      throw new OrganizerPhoneRequiredError();
    }

    const changed =
      current.billingModule !== input.billingModule ||
      current.organizerPhoneNormalized !== organizerPhoneNormalized ||
      current.organizerPhoneDisplay !== organizerPhoneDisplay;

    const [updated] = await tx
      .update(organizations)
      .set({
        billingModule: input.billingModule,
        organizerPhoneNormalized,
        organizerPhoneDisplay,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId))
      .returning();

    if (changed) {
      await tx.insert(auditEvents).values({
        organizationId,
        entityType: "organization",
        entityId: organizationId,
        action: "billing_module_updated",
        actorType: "user",
        actorId: actorUserId,
        metadata: {
          previousBillingModule: current.billingModule,
          billingModule: updated.billingModule,
          organizerPhoneChanged: current.organizerPhoneNormalized !== updated.organizerPhoneNormalized,
        },
      });
    }

    return publicSettings(updated);
  });
}
