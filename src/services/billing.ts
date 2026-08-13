import { db } from "@/db";
import { groups, groupParticipants, billingPeriods, charges } from "@/db/schema";
import { and, eq } from "drizzle-orm";

function dueDateFor(referenceMonth: string, billingDay: number): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  const day = String(billingDay).padStart(2, "0");
  const monthStr = String(month).padStart(2, "0");
  return `${year}-${monthStr}-${day}`;
}

export async function generateBillingPeriod(groupId: string, referenceMonth: string) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) throw new Error("Grupo não encontrado");

  const [existingPeriod] = await db
    .select()
    .from(billingPeriods)
    .where(and(eq(billingPeriods.groupId, groupId), eq(billingPeriods.referenceMonth, referenceMonth)));
  if (existingPeriod) throw new Error("Já existe uma cobrança gerada para este mês");

  return db.transaction(async (tx) => {
    const [period] = await tx
      .insert(billingPeriods)
      .values({
        groupId,
        referenceMonth,
        dueDate: dueDateFor(referenceMonth, group.billingDay),
      })
      .returning();

    const activeParticipants = await tx
      .select()
      .from(groupParticipants)
      .where(and(eq(groupParticipants.groupId, groupId), eq(groupParticipants.status, "active")));

    if (activeParticipants.length > 0) {
      await tx.insert(charges).values(
        activeParticipants.map((link) => ({
          billingPeriodId: period.id,
          participantId: link.participantId,
          originalAmount: group.defaultAmount,
          discountAmount: 0,
          fineAmount: 0,
          interestAmount: 0,
          totalAmount: group.defaultAmount,
          dueDate: period.dueDate,
        })),
      );
    }

    return period;
  });
}
