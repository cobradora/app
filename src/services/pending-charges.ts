import { db } from "@/db";
import { charges, billingPeriods, groups, participants } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { normalizePhoneBR } from "@/lib/phone";

export async function listPendingChargesByPhone(groupPublicSlug: string, rawPhone: string) {
  const [group] = await db.select().from(groups).where(eq(groups.publicSlug, groupPublicSlug));
  if (!group) return [];

  const phoneNormalized = normalizePhoneBR(rawPhone);
  const [participant] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.organizationId, group.organizationId), eq(participants.phoneNormalized, phoneNormalized)));
  if (!participant) return [];

  const rows = await db
    .select({
      chargeId: charges.id,
      totalAmount: charges.totalAmount,
      dueDate: charges.dueDate,
      referenceMonth: billingPeriods.referenceMonth,
    })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .where(
      and(
        eq(billingPeriods.groupId, group.id),
        eq(charges.participantId, participant.id),
        inArray(charges.status, ["open", "checkout_pending"]),
      ),
    );

  return rows;
}
