import { db } from "@/db";
import { charges, billingPeriods, groups, participants, financialContacts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { sendPaymentReminderTemplate } from "@/lib/whatsapp";
import { formatMoney, formatDate } from "@/lib/mock-data";

export type WhatsappReminderFailure = {
  chargeId: string;
  code: "send_failed";
};

/**
 * Manda o lembrete (template aprovado) para o responsável financeiro de
 * cada cobrança em aberto — uma mensagem por cobrança, não agregada por
 * pessoa. Mesmo padrão de "quem paga" já usado no checkout público
 * (src/services/checkout.ts): o telefone é do financial_contact, o nome
 * exibido é o do participante com financial_role = "responsible".
 */
export async function sendDailyPaymentReminders() {
  const appBaseUrl = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const openCharges = await db
    .select({
      chargeId: charges.id,
      totalAmount: charges.totalAmount,
      dueDate: charges.dueDate,
      financialContactId: participants.financialContactId,
      phoneNormalized: financialContacts.phoneNormalized,
      groupName: groups.name,
      groupPublicSlug: groups.publicSlug,
    })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .innerJoin(financialContacts, eq(participants.financialContactId, financialContacts.id))
    .where(and(eq(charges.status, "open"), eq(groups.status, "active")));

  if (openCharges.length === 0) {
    return { sent: 0, failures: [] as WhatsappReminderFailure[] };
  }

  const financialContactIds = [...new Set(openCharges.map((charge) => charge.financialContactId))];
  const responsibles = await db
    .select({ financialContactId: participants.financialContactId, name: participants.name })
    .from(participants)
    .where(and(inArray(participants.financialContactId, financialContactIds), eq(participants.financialRole, "responsible")));
  const responsibleNameByContact = new Map(responsibles.map((row) => [row.financialContactId, row.name]));

  let sent = 0;
  const failures: WhatsappReminderFailure[] = [];

  for (const charge of openCharges) {
    const participantName = responsibleNameByContact.get(charge.financialContactId) ?? "Responsável";
    try {
      await sendPaymentReminderTemplate(charge.phoneNormalized, {
        participantName,
        groupName: charge.groupName,
        amount: formatMoney(charge.totalAmount / 100),
        dueDate: formatDate(charge.dueDate),
        groupUrl: `${appBaseUrl}/g/${charge.groupPublicSlug}`,
      });
      sent += 1;
    } catch (error) {
      console.error("CobraDora: falha ao enviar lembrete WhatsApp", { chargeId: charge.chargeId, error });
      failures.push({ chargeId: charge.chargeId, code: "send_failed" });
    }
  }

  return { sent, failures };
}
