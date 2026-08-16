import { db } from "@/db";
import { groups, groupParticipants, billingPeriods, charges, participants } from "@/db/schema";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  BILLING_TIME_ZONE,
  currentReferenceMonth,
  getBillingLocalDateParts,
  isReferenceMonth,
  renewalDateFor,
  shiftReferenceMonth,
} from "@/lib/billing-cycle";

export async function generateBillingPeriod(
  organizationId: string,
  groupId: string,
  referenceMonth: string,
  options?: { dueDate?: string },
  now = new Date(),
) {
  if (!isReferenceMonth(referenceMonth)) throw new Error("Mês de referência inválido");

  const [group] = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, groupId),
        eq(groups.organizationId, organizationId),
        eq(groups.status, "active"),
      ),
    );
  if (!group) throw new Error("Grupo não encontrado");

  const dueDate = options?.dueDate ?? (group.billingDay !== null ? renewalDateFor(referenceMonth, group.billingDay) : null);
  if (!dueDate) throw new Error("Grupo sem dia de renovação configurado e sem data informada");

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(billingPeriods)
      .values({
        groupId,
        referenceMonth,
        dueDate,
      })
      .onConflictDoNothing({ target: [billingPeriods.groupId, billingPeriods.referenceMonth] })
      .returning();

    let period = inserted;
    // Corte de elegibilidade: por padrão é o vencimento do próprio período
    // (comportamento original, usado pelo Cron — ver comentário abaixo).
    // Quando o período JÁ existia (ex.: 2º clique em "Renovar ciclo" no
    // mesmo mês), usamos a data de hoje em vez do vencimento congelado da
    // primeira geração — participantes de grupo manual entram elegíveis "a
    // partir de hoje" (participants.ts), e só viram cobrança de fato quando
    // o admin renovar de novo; travar no vencimento antigo os deixaria de
    // fora pra sempre.
    let eligibilityCutoff = period?.dueDate;
    if (!period) {
      const [existing] = await tx
        .select()
        .from(billingPeriods)
        .where(
          and(
            eq(billingPeriods.groupId, groupId),
            eq(billingPeriods.referenceMonth, referenceMonth),
          ),
        );
      if (!existing) throw new Error("Falha ao recuperar ciclo já gerado");
      period = existing;
      eligibilityCutoff = todayInBillingTimeZone(now);
    }

    const eligibleParticipants = await tx
      .select({
        participantId: groupParticipants.participantId,
        billingAmount: groupParticipants.billingAmount,
      })
      .from(groupParticipants)
      .innerJoin(
        participants,
        and(
          eq(groupParticipants.participantId, participants.id),
          eq(participants.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(groupParticipants.groupId, groupId),
          lte(groupParticipants.billingStartsOn, eligibilityCutoff),
          // O Cron pode fazer catch-up dias depois. A elegibilidade precisa
          // refletir quem fazia parte do grupo no corte, não apenas quem está
          // ativo no instante tardio da execução.
          sql<boolean>`(${groupParticipants.joinedAt} at time zone ${BILLING_TIME_ZONE})::date <= ${eligibilityCutoff}::date`,
          or(
            isNull(groupParticipants.leftAt),
            sql<boolean>`(${groupParticipants.leftAt} at time zone ${BILLING_TIME_ZONE})::date >= ${eligibilityCutoff}::date`,
          ),
        ),
      );

    const alreadyCharged = new Set(
      (
        await tx
          .select({ participantId: charges.participantId })
          .from(charges)
          .where(eq(charges.billingPeriodId, period.id))
      ).map((row) => row.participantId),
    );
    // O período pode já existir (ex.: clique repetido em "Renovar ciclo" num
    // grupo manual) — nesse caso só complementamos quem ainda não tem
    // cobrança nele, sem duplicar quem já foi cobrado.
    const participantsToCharge = eligibleParticipants.filter((link) => !alreadyCharged.has(link.participantId));

    if (participantsToCharge.length > 0) {
      await tx.insert(charges).values(
        participantsToCharge.map((link) => ({
          billingPeriodId: period.id,
          participantId: link.participantId,
          originalAmount: link.billingAmount,
          discountAmount: 0,
          fineAmount: 0,
          interestAmount: 0,
          totalAmount: link.billingAmount,
          dueDate: eligibilityCutoff,
        })),
      );
    }

    return period;
  });
}

/**
 * Gera a competência vencida mais recente e faz catch-up desde a última já
 * persistida. Para um grupo ainda sem histórico, nunca inventa meses antes
 * do primeiro dia de renovação observado pelo Cron.
 */
type BillingPeriodGenerator = (
  organizationId: string,
  groupId: string,
  referenceMonth: string,
) => Promise<unknown>;

export type BillingCronFailure = {
  groupId: string;
  referenceMonth: string | null;
  code: "generation_failed";
};

function logCronGroupFailure(groupId: string, referenceMonth: string | null, error: unknown) {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const databaseCode =
    typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;

  // Nunca inclui mensagem, stack, payload ou configuração do gateway: esses
  // valores podem conter dados sensíveis dependendo da origem da exceção.
  console.error("CobraDora Cron: falha isolada ao gerar ciclo", {
    groupId,
    referenceMonth,
    errorName,
    ...(databaseCode ? { databaseCode } : {}),
  });
}

export async function generateDueBillingPeriods(
  now = new Date(),
  generatePeriod: BillingPeriodGenerator = generateBillingPeriod,
) {
  const local = getBillingLocalDateParts(now);
  const current = currentReferenceMonth(now);
  const activeGroups = await db.select().from(groups).where(eq(groups.status, "active"));
  const generated: { groupId: string; referenceMonth: string }[] = [];
  const failures: BillingCronFailure[] = [];

  for (const group of activeGroups) {
    if (group.billingDay === null) continue; // renovação manual — sem cron para este grupo
    let attemptedReferenceMonth: string | null = null;
    try {
      const [latest] = await db
        .select({ referenceMonth: billingPeriods.referenceMonth })
        .from(billingPeriods)
        .where(eq(billingPeriods.groupId, group.id))
        .orderBy(desc(billingPeriods.referenceMonth))
        .limit(1);

      if (!latest && local.day < group.billingDay) continue;

      const lastDueReference = local.day >= group.billingDay ? current : shiftReferenceMonth(current, -1);
      let next = latest ? shiftReferenceMonth(latest.referenceMonth, 1) : lastDueReference;
      let safety = 0;

      while (next <= lastDueReference && safety < 120) {
        attemptedReferenceMonth = next;
        await generatePeriod(group.organizationId, group.id, next);
        generated.push({ groupId: group.id, referenceMonth: next });
        next = shiftReferenceMonth(next, 1);
        safety += 1;
      }
    } catch (error) {
      logCronGroupFailure(group.id, attemptedReferenceMonth, error);
      failures.push({
        groupId: group.id,
        referenceMonth: attemptedReferenceMonth,
        code: "generation_failed",
      });
    }
  }

  return {
    examinedGroups: activeGroups.length,
    generated,
    failures,
  };
}

export class GroupCycleNotManualError extends Error {
  constructor() {
    super("Este grupo já tem um dia de renovação configurado; use o ciclo automático");
    this.name = "GroupCycleNotManualError";
  }
}

function todayInBillingTimeZone(now: Date): string {
  const local = getBillingLocalDateParts(now);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

/**
 * Gera o ciclo do mês corrente sob demanda para um grupo em modo de
 * renovação manual (billingDay nulo). Grupos com ciclo automático precisam
 * usar o Cron — essa função recusa para não duplicar/confundir o dia de
 * vencimento configurado.
 */
export async function renewGroupCycleManually(organizationId: string, groupId: string, now = new Date()) {
  const [group] = await db
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
  if (group.billingDay !== null) throw new GroupCycleNotManualError();

  const referenceMonth = currentReferenceMonth(now);
  const dueDate = todayInBillingTimeZone(now);
  return generateBillingPeriod(organizationId, groupId, referenceMonth, { dueDate }, now);
}
