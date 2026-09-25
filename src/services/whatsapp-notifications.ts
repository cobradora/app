import { createHash } from "node:crypto";
import { db } from "@/db";
import {
  billingPeriods,
  charges,
  financialContacts,
  groups,
  organizations,
  participants,
  whatsappNotifications,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { formatDate, formatMoney } from "@/lib/mock-data";
import {
  sendOrganizerNewCycleTemplate,
  sendOrganizerListUpdateTemplate,
  sendPaymentReminderTemplate,
  WhatsappSendError,
} from "@/lib/whatsapp";

const DEAD_LETTER_AT = new Date("9999-12-31T23:59:59.999Z");
const MAX_SEND_ATTEMPTS = 5;
const TEMPORARY_ELIGIBILITY_RETRY_MS = 15 * 60_000;

const chargeReminderPayloadSchema = z.object({
  participantName: z.string().min(1).max(200),
  groupName: z.string().min(1).max(200),
  amount: z.string().min(1).max(80),
  dueDate: z.string().min(1).max(40),
  groupUrl: z.string().url().max(500),
});

const organizerUpdatePayloadSchema = z.object({
  groupName: z.string().min(1).max(200),
  referenceMonth: z.string().regex(/^\d{2}\/\d{4}$/),
  paidList: z.string().min(1).max(1000),
  pendingList: z.string().min(1).max(1000),
});

const organizerCycleStartPayloadSchema = z.object({
  groupName: z.string().min(1).max(200),
  referenceMonth: z.string().regex(/^\d{2}\/\d{4}$/),
  participantCount: z.string().regex(/^\d+$/),
  totalAmount: z.string().min(1).max(80),
});

type TransactionClient = Pick<typeof db, "select" | "insert">;
type SelectClient = Pick<typeof db, "select">;

function hasActiveWhatsappConsent(input: { whatsappOptInAt: Date | null; whatsappOptOutAt: Date | null }) {
  return Boolean(
    input.whatsappOptInAt &&
      (!input.whatsappOptOutAt || input.whatsappOptInAt.getTime() > input.whatsappOptOutAt.getTime()),
  );
}

function formatReferenceMonth(referenceMonth: string): string {
  const [year, month] = referenceMonth.split("-");
  return `${month}/${year}`;
}

function truncateList(names: string[]): string {
  if (names.length === 0) return "Nenhum";
  const value = names.join(", ");
  return value.length <= 1000 ? value : `${value.slice(0, 996).trimEnd()}…`;
}

function whatsappAppBaseUrl(): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new WhatsappSendError("app_base_url_invalid", "APP_BASE_URL ausente em produção");
    }
    return "http://localhost:3000";
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new WhatsappSendError("app_base_url_invalid", "APP_BASE_URL inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WhatsappSendError("app_base_url_invalid", "APP_BASE_URL deve usar HTTP ou HTTPS");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new WhatsappSendError("app_base_url_invalid", "APP_BASE_URL deve usar HTTPS em produção");
  }
  return parsed.href.replace(/\/$/, "");
}

type ChargeRevisionRow = { id: string; totalAmount: number; dueDate: string };

function chargeRevision(rows: ChargeRevisionRow[]): string {
  const canonical = rows
    .map((row) => `${row.id}:${row.totalAmount}:${row.dueDate}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 20);
}

function earliestDueDate(rows: { dueDate: string }[]): string {
  const dueDate = rows.map((row) => row.dueDate).sort()[0];
  if (!dueDate) throw new WhatsappSendError("payload_invalid", "Cobrança sem vencimento para o WhatsApp");
  return formatDate(dueDate);
}

async function buildOrganizerUpdatePayload(
  client: SelectClient,
  organizationId: string,
  billingPeriodId: string,
) {
  const [period] = await client
    .select({
      referenceMonth: billingPeriods.referenceMonth,
      groupName: groups.name,
    })
    .from(billingPeriods)
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .where(
      and(
        eq(billingPeriods.id, billingPeriodId),
        eq(groups.organizationId, organizationId),
        eq(groups.status, "active"),
      ),
    );
  if (!period) return null;

  const periodCharges = await client
    .select({ name: participants.name, status: charges.status })
    .from(charges)
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .where(eq(charges.billingPeriodId, billingPeriodId))
    .orderBy(asc(participants.name));

  return {
    groupName: period.groupName,
    referenceMonth: formatReferenceMonth(period.referenceMonth),
    paidList: truncateList(
      periodCharges
        .filter((charge) => charge.status === "paid" || charge.status === "manually_paid")
        .map((charge) => charge.name),
    ),
    pendingList: truncateList(
      periodCharges
        .filter((charge) => charge.status === "open" || charge.status === "checkout_pending")
        .map((charge) => charge.name),
    ),
  };
}

async function buildOrganizerCycleStartPayload(
  client: SelectClient,
  organizationId: string,
  billingPeriodId: string,
) {
  const [period] = await client
    .select({
      referenceMonth: billingPeriods.referenceMonth,
      groupName: groups.name,
    })
    .from(billingPeriods)
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .where(
      and(
        eq(billingPeriods.id, billingPeriodId),
        eq(groups.organizationId, organizationId),
        eq(groups.status, "active"),
      ),
    );
  if (!period) return null;

  const periodCharges = await client
    .select({ totalAmount: charges.totalAmount })
    .from(charges)
    .where(eq(charges.billingPeriodId, billingPeriodId));

  return {
    groupName: period.groupName,
    referenceMonth: formatReferenceMonth(period.referenceMonth),
    participantCount: String(periodCharges.length),
    totalAmount: formatMoney(periodCharges.reduce((sum, charge) => sum + charge.totalAmount, 0) / 100),
  };
}

/**
 * Cria no máximo uma cobrança privada por responsável e revisão financeira
 * da competência. A revisão ignora mudanças de status (um pagamento não
 * gera outro lembrete), mas muda quando uma charge, valor ou vencimento é
 * acrescentado/alterado por uma renovação manual repetida.
 */
export async function enqueueChargeReminderNotifications(billingPeriodIds?: string[]) {
  if (billingPeriodIds && billingPeriodIds.length === 0) return [] as string[];
  const selectedBillingPeriodIds = billingPeriodIds ? [...new Set(billingPeriodIds)] : undefined;
  const rows = await db
    .select({
      organizationId: organizations.id,
      billingPeriodId: billingPeriods.id,
      chargeId: charges.id,
      chargeStatus: charges.status,
      dueDate: charges.dueDate,
      financialContactId: financialContacts.id,
      phoneNormalized: financialContacts.phoneNormalized,
      whatsappOptInAt: financialContacts.whatsappOptInAt,
      whatsappOptOutAt: financialContacts.whatsappOptOutAt,
      participantName: participants.name,
      financialRole: participants.financialRole,
      totalAmount: charges.totalAmount,
      groupName: groups.name,
      groupPublicSlug: groups.publicSlug,
    })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .innerJoin(organizations, eq(groups.organizationId, organizations.id))
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .innerJoin(financialContacts, eq(participants.financialContactId, financialContacts.id))
    .where(
      and(
        eq(groups.status, "active"),
        eq(organizations.status, "active"),
        eq(organizations.billingModule, "cobradora"),
        isNotNull(financialContacts.whatsappOptInAt),
        or(
          isNull(financialContacts.whatsappOptOutAt),
          sql<boolean>`${financialContacts.whatsappOptInAt} > ${financialContacts.whatsappOptOutAt}`,
        ),
        selectedBillingPeriodIds ? inArray(billingPeriods.id, selectedBillingPeriodIds) : undefined,
      ),
    )
    .orderBy(asc(billingPeriods.referenceMonth), asc(participants.name));

  const aggregates = new Map<string, {
    organizationId: string;
    billingPeriodId: string;
    financialContactId: string;
    phoneNormalized: string;
    responsibleName: string | null;
    firstOpenParticipantName: string | null;
    totalAmount: number;
    openDueDates: { dueDate: string }[];
    revisionRows: ChargeRevisionRow[];
    groupName: string;
    groupPublicSlug: string;
  }>();

  for (const row of rows) {
    if (!hasActiveWhatsappConsent(row)) continue;
    const key = `${row.billingPeriodId}:${row.financialContactId}`;
    const current = aggregates.get(key);
    if (current) {
      current.revisionRows.push({ id: row.chargeId, totalAmount: row.totalAmount, dueDate: row.dueDate });
      if (row.chargeStatus === "open") {
        current.totalAmount += row.totalAmount;
        current.openDueDates.push({ dueDate: row.dueDate });
        current.firstOpenParticipantName ??= row.participantName;
      }
      if (row.financialRole === "responsible") current.responsibleName = row.participantName;
      continue;
    }
    aggregates.set(key, {
      organizationId: row.organizationId,
      billingPeriodId: row.billingPeriodId,
      financialContactId: row.financialContactId,
      phoneNormalized: row.phoneNormalized,
      responsibleName: row.financialRole === "responsible" ? row.participantName : null,
      firstOpenParticipantName: row.chargeStatus === "open" ? row.participantName : null,
      totalAmount: row.chargeStatus === "open" ? row.totalAmount : 0,
      openDueDates: row.chargeStatus === "open" ? [{ dueDate: row.dueDate }] : [],
      revisionRows: [{ id: row.chargeId, totalAmount: row.totalAmount, dueDate: row.dueDate }],
      groupName: row.groupName,
      groupPublicSlug: row.groupPublicSlug,
    });
  }

  const activeAggregates = [...aggregates.values()].filter(
    (row) => row.totalAmount > 0 && row.firstOpenParticipantName,
  );
  if (activeAggregates.length === 0) return [] as string[];
  const responsibleNames = new Map(
    (
      await db
        .select({
          financialContactId: participants.financialContactId,
          name: participants.name,
        })
        .from(participants)
        .where(
          and(
            inArray(participants.financialContactId, [
              ...new Set(activeAggregates.map((row) => row.financialContactId)),
            ]),
            eq(participants.financialRole, "responsible"),
          ),
        )
    ).map((participant) => [participant.financialContactId, participant.name]),
  );
  const appBaseUrl = whatsappAppBaseUrl();
  const inserted = await db
    .insert(whatsappNotifications)
    .values(
      activeAggregates.map((row) => {
        const revision = chargeRevision(row.revisionRows);
        return {
          organizationId: row.organizationId,
          billingPeriodId: row.billingPeriodId,
          financialContactId: row.financialContactId,
          kind: "charge_reminder" as const,
          recipientPhoneNormalized: row.phoneNormalized,
          idempotencyKey: `charge-reminder:${row.billingPeriodId}:${row.financialContactId}:${revision}`,
          payload: {
            participantName:
              responsibleNames.get(row.financialContactId) ??
              row.responsibleName ??
              row.firstOpenParticipantName!,
            groupName: row.groupName,
            amount: formatMoney(row.totalAmount / 100),
            dueDate: earliestDueDate(row.openDueDates),
            groupUrl: `${appBaseUrl}/g/${row.groupPublicSlug}`,
            chargeRevision: revision,
          },
        };
      }),
    )
    .onConflictDoNothing({ target: whatsappNotifications.idempotencyKey })
    .returning({ id: whatsappNotifications.id });

  return inserted.map((row) => row.id);
}

/** Uma mensagem ao organizador por competência efetivamente iniciada. */
export async function enqueueOrganizerCycleStartNotifications(billingPeriodIds: string[]): Promise<string[]> {
  const selectedBillingPeriodIds = [...new Set(billingPeriodIds)];
  if (selectedBillingPeriodIds.length === 0) return [];

  const periods = await db
    .select({
      organizationId: organizations.id,
      billingPeriodId: billingPeriods.id,
      organizerPhoneNormalized: organizations.organizerPhoneNormalized,
    })
    .from(billingPeriods)
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .innerJoin(organizations, eq(groups.organizationId, organizations.id))
    .where(
      and(
        inArray(billingPeriods.id, selectedBillingPeriodIds),
        eq(groups.status, "active"),
        eq(organizations.status, "active"),
        eq(organizations.billingModule, "cobradora"),
        isNotNull(organizations.organizerPhoneNormalized),
      ),
    );

  const values: (typeof whatsappNotifications.$inferInsert)[] = [];
  for (const period of periods) {
    if (!period.organizerPhoneNormalized) continue;
    const payload = await buildOrganizerCycleStartPayload(
      db,
      period.organizationId,
      period.billingPeriodId,
    );
    if (!payload) continue;
    values.push({
      organizationId: period.organizationId,
      billingPeriodId: period.billingPeriodId,
      financialContactId: null,
      kind: "organizer_cycle_start",
      recipientPhoneNormalized: period.organizerPhoneNormalized,
      idempotencyKey: `organizer-cycle-start:${period.billingPeriodId}`,
      payload,
    });
  }
  if (values.length === 0) return [];

  const inserted = await db
    .insert(whatsappNotifications)
    .values(values)
    .onConflictDoNothing({ target: whatsappNotifications.idempotencyKey })
    .returning({ id: whatsappNotifications.id });
  return inserted.map((row) => row.id);
}

/**
 * Persiste os dois lados do início do ciclo. A chave das cobranças é a mesma
 * usada pelo cron diário, portanto uma execução posterior não duplica envio.
 */
export async function enqueueCycleStartNotifications(billingPeriodIds: string[]): Promise<string[]> {
  const contactNotificationIds = await enqueueChargeReminderNotifications(billingPeriodIds);
  const organizerNotificationIds = await enqueueOrganizerCycleStartNotifications(billingPeriodIds);
  return [...contactNotificationIds, ...organizerNotificationIds];
}

/**
 * Reconcilia somente a competência mais recente de cada grupo ativo. Assim o
 * cron recupera uma falha entre o commit do ciclo e a outbox sem disparar um
 * backlog histórico de mensagens ao ativar a funcionalidade.
 */
export async function enqueueLatestCycleStartNotifications(): Promise<string[]> {
  const latestPeriods = await db
    .selectDistinctOn([billingPeriods.groupId], { billingPeriodId: billingPeriods.id })
    .from(billingPeriods)
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .innerJoin(organizations, eq(groups.organizationId, organizations.id))
    .where(
      and(
        eq(groups.status, "active"),
        eq(organizations.status, "active"),
        eq(organizations.billingModule, "cobradora"),
      ),
    )
    .orderBy(billingPeriods.groupId, desc(billingPeriods.referenceMonth));

  return enqueueCycleStartNotifications(latestPeriods.map((period) => period.billingPeriodId));
}

/** Enfileira um resumo por competência afetada pelo checkout confirmado. */
export async function enqueueOrganizerListUpdates(
  tx: TransactionClient,
  input: {
    organizationId: string;
    paymentId: string;
    billingPeriodIds: string[];
  },
): Promise<string[]> {
  const [organization] = await tx
    .select({
      billingModule: organizations.billingModule,
      status: organizations.status,
      organizerPhoneNormalized: organizations.organizerPhoneNormalized,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId));
  if (
    organization?.status !== "active" ||
    organization.billingModule !== "cobradora" ||
    !organization.organizerPhoneNormalized
  ) return [];

  const insertedIds: string[] = [];
  for (const billingPeriodId of [...new Set(input.billingPeriodIds)]) {
    const payload = await buildOrganizerUpdatePayload(tx, input.organizationId, billingPeriodId);
    if (!payload) continue;

    const [inserted] = await tx
      .insert(whatsappNotifications)
      .values({
        organizationId: input.organizationId,
        billingPeriodId,
        financialContactId: null,
        kind: "organizer_list_update",
        recipientPhoneNormalized: organization.organizerPhoneNormalized,
        idempotencyKey: `organizer-list-update:${input.paymentId}:${billingPeriodId}`,
        payload,
      })
      .onConflictDoNothing({ target: whatsappNotifications.idempotencyKey })
      .returning({ id: whatsappNotifications.id });
    if (inserted) insertedIds.push(inserted.id);
  }
  return insertedIds;
}

type FailurePolicy = { code: string; retryable: boolean; retryAfterMs: number | null };

function failurePolicy(error: unknown): FailurePolicy {
  if (error instanceof WhatsappSendError) {
    return { code: error.code, retryable: error.retryable, retryAfterMs: error.retryAfterMs };
  }
  if (error instanceof z.ZodError) {
    return { code: "payload_invalid", retryable: false, retryAfterMs: null };
  }
  // Falhas de rede, timeout e respostas ambíguas continuam retryable. A
  // outbox não promete exactly-once para o efeito externo da Meta.
  return { code: "send_failed", retryable: true, retryAfterMs: null };
}

function retryDelayMs(attemptCount: number, retryAfterMs: number | null): number {
  const exponential = Math.min(24 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 8));
  return Math.max(exponential, retryAfterMs ?? 0);
}

export type WhatsappDispatchFailure = { notificationId: string; code: string };

type NotificationEligibility =
  | { state: "eligible"; recipient: string; payload: unknown }
  | { state: "deferred"; code: string }
  | { state: "terminal"; code: string };

function payloadChargeRevision(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const revision = (payload as { chargeRevision?: unknown }).chargeRevision;
  return typeof revision === "string" ? revision : null;
}

async function eligibleNotification(
  notification: typeof whatsappNotifications.$inferSelect,
): Promise<NotificationEligibility> {
  const [organization] = await db
    .select({
      status: organizations.status,
      billingModule: organizations.billingModule,
      organizerPhoneNormalized: organizations.organizerPhoneNormalized,
    })
    .from(organizations)
    .where(eq(organizations.id, notification.organizationId));
  if (!organization) return { state: "terminal", code: "no_longer_eligible" };
  if (organization.status !== "active" || organization.billingModule !== "cobradora") {
    return { state: "deferred", code: "organization_temporarily_ineligible" };
  }

  if (notification.kind !== "organizer_list_update") {
    const [period] = await db
      .select({ groupId: billingPeriods.groupId })
      .from(billingPeriods)
      .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
      .where(
        and(
          eq(billingPeriods.id, notification.billingPeriodId),
          eq(groups.organizationId, notification.organizationId),
        ),
      );
    if (!period) return { state: "terminal", code: "no_longer_eligible" };
    const [latestPeriod] = await db
      .select({ id: billingPeriods.id })
      .from(billingPeriods)
      .where(eq(billingPeriods.groupId, period.groupId))
      .orderBy(desc(billingPeriods.referenceMonth))
      .limit(1);
    if (latestPeriod?.id !== notification.billingPeriodId) {
      return { state: "terminal", code: "superseded" };
    }
  }

  if (notification.kind === "organizer_list_update") {
    if (!organization.organizerPhoneNormalized) return { state: "deferred", code: "organizer_phone_missing" };
    const payload = await buildOrganizerUpdatePayload(
      db,
      notification.organizationId,
      notification.billingPeriodId,
    );
    if (!payload) return { state: "deferred", code: "group_temporarily_ineligible" };
    return { state: "eligible", recipient: organization.organizerPhoneNormalized, payload };
  }

  if (notification.kind === "organizer_cycle_start") {
    if (!organization.organizerPhoneNormalized) return { state: "deferred", code: "organizer_phone_missing" };
    const payload = await buildOrganizerCycleStartPayload(
      db,
      notification.organizationId,
      notification.billingPeriodId,
    );
    if (!payload) return { state: "deferred", code: "group_temporarily_ineligible" };
    return { state: "eligible", recipient: organization.organizerPhoneNormalized, payload };
  }

  if (!notification.financialContactId) return { state: "terminal", code: "payload_invalid" };

  const currentCharges = await db
    .select({
      id: charges.id,
      status: charges.status,
      totalAmount: charges.totalAmount,
      participantName: participants.name,
      financialRole: participants.financialRole,
      phoneNormalized: financialContacts.phoneNormalized,
      whatsappOptInAt: financialContacts.whatsappOptInAt,
      whatsappOptOutAt: financialContacts.whatsappOptOutAt,
      dueDate: charges.dueDate,
      groupName: groups.name,
      groupPublicSlug: groups.publicSlug,
      groupStatus: groups.status,
    })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .innerJoin(financialContacts, eq(participants.financialContactId, financialContacts.id))
    .where(
      and(
        eq(charges.billingPeriodId, notification.billingPeriodId),
        eq(groups.organizationId, notification.organizationId),
        eq(financialContacts.id, notification.financialContactId),
      ),
    )
    .orderBy(asc(participants.name));
  if (currentCharges.length === 0) return { state: "terminal", code: "no_longer_eligible" };
  if (currentCharges[0].groupStatus !== "active") {
    return { state: "deferred", code: "group_temporarily_ineligible" };
  }
  if (!hasActiveWhatsappConsent(currentCharges[0])) {
    return { state: "terminal", code: "consent_inactive" };
  }

  const currentRevision = chargeRevision(currentCharges);
  const queuedRevision = payloadChargeRevision(notification.payload);
  if (queuedRevision && queuedRevision !== currentRevision) {
    return { state: "terminal", code: "superseded" };
  }

  // Não envie um total parcial enquanto uma das charges consolidadas está
  // em checkout. Quando ela voltar a open (ou for paga), a mesma revisão é
  // reavaliada com um total coerente.
  if (currentCharges.some((charge) => charge.status === "checkout_pending")) {
    return { state: "deferred", code: "checkout_pending" };
  }
  const openCharges = currentCharges.filter((charge) => charge.status === "open");
  if (openCharges.length === 0) return { state: "terminal", code: "no_longer_eligible" };

  const [responsible] = await db
    .select({ name: participants.name })
    .from(participants)
    .where(
      and(
        eq(participants.organizationId, notification.organizationId),
        eq(participants.financialContactId, notification.financialContactId),
        eq(participants.financialRole, "responsible"),
      ),
    );
  const first = openCharges[0];
  const appBaseUrl = whatsappAppBaseUrl();
  return {
    state: "eligible",
    recipient: first.phoneNormalized,
    payload: {
      participantName: responsible?.name ?? first.participantName,
      groupName: first.groupName,
      amount: formatMoney(openCharges.reduce((sum, row) => sum + row.totalAmount, 0) / 100),
      dueDate: earliestDueDate(openCharges),
      groupUrl: `${appBaseUrl}/g/${first.groupPublicSlug}`,
      chargeRevision: currentRevision,
    },
  };
}

function claimGuard(notification: typeof whatsappNotifications.$inferSelect) {
  return and(
    eq(whatsappNotifications.id, notification.id),
    eq(whatsappNotifications.status, "sending"),
    eq(whatsappNotifications.attemptCount, notification.attemptCount),
  );
}

async function markNotificationSkipped(
  notification: typeof whatsappNotifications.$inferSelect,
  code: string,
  now: Date,
): Promise<boolean> {
  const [updated] = await db
    .update(whatsappNotifications)
    .set({
      status: "failed",
      // O claim incrementa attemptCount como fencing token, mas uma
      // inelegibilidade anterior ao HTTP não consumiu tentativa de envio.
      attemptCount: sql`${whatsappNotifications.attemptCount} - 1`,
      failedAt: now,
      updatedAt: now,
      nextAttemptAt: DEAD_LETTER_AT,
      errorCode: code,
    })
    .where(claimGuard(notification))
    .returning({ id: whatsappNotifications.id });
  return Boolean(updated);
}

async function deferNotification(
  notification: typeof whatsappNotifications.$inferSelect,
  code: string,
  now: Date,
): Promise<boolean> {
  const [updated] = await db
    .update(whatsappNotifications)
    .set({
      status: "failed",
      // O claim serviu apenas para revalidar elegibilidade; preserve o
      // contador exclusivamente para chamadas efetivas à Meta.
      attemptCount: sql`${whatsappNotifications.attemptCount} - 1`,
      failedAt: now,
      updatedAt: now,
      nextAttemptAt: new Date(now.getTime() + TEMPORARY_ELIGIBILITY_RETRY_MS),
      errorCode: code,
    })
    .where(claimGuard(notification))
    .returning({ id: whatsappNotifications.id });
  return Boolean(updated);
}

/** Claim com fencing por attemptCount; a ambiguidade do efeito externo permanece. */
export async function dispatchWhatsappNotifications(
  notificationIds?: string[],
  batchLimit = 200,
): Promise<{ sent: number; skipped: number; failures: WhatsappDispatchFailure[] }> {
  if (notificationIds && notificationIds.length === 0) return { sent: 0, skipped: 0, failures: [] };
  await db
    .update(whatsappNotifications)
    .set({
      status: "failed",
      errorCode: "claim_timeout",
      nextAttemptAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(whatsappNotifications.status, "sending"),
        or(
          isNull(whatsappNotifications.lastAttemptAt),
          sql<boolean>`${whatsappNotifications.lastAttemptAt} <= clock_timestamp() - interval '15 minutes'`,
        ),
      ),
    );
  const conditions = [
    inArray(whatsappNotifications.status, ["queued", "failed"]),
    sql<boolean>`${whatsappNotifications.nextAttemptAt} <= now()`,
  ];
  if (notificationIds) conditions.push(inArray(whatsappNotifications.id, notificationIds));
  const candidates = await db
    .select()
    .from(whatsappNotifications)
    .where(and(...conditions))
    .orderBy(whatsappNotifications.createdAt)
    .limit(Math.max(1, Math.min(200, Math.trunc(batchLimit))));

  let sent = 0;
  let skipped = 0;
  const failures: WhatsappDispatchFailure[] = [];
  for (const candidate of candidates) {
    const [claimed] = await db
      .update(whatsappNotifications)
      .set({
        status: "sending",
        attemptCount: sql`${whatsappNotifications.attemptCount} + 1`,
        lastAttemptAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
        errorCode: null,
      })
      .where(
        and(
          eq(whatsappNotifications.id, candidate.id),
          inArray(whatsappNotifications.status, ["queued", "failed"]),
          sql<boolean>`${whatsappNotifications.nextAttemptAt} <= clock_timestamp()`,
        ),
      )
      .returning();
    if (!claimed) continue;

    try {
      const eligible = await eligibleNotification(claimed);
      if (eligible.state === "terminal") {
        if (await markNotificationSkipped(claimed, eligible.code, new Date())) skipped += 1;
        continue;
      }
      if (eligible.state === "deferred") {
        if (await deferNotification(claimed, eligible.code, new Date())) {
          failures.push({ notificationId: claimed.id, code: eligible.code });
        }
        continue;
      }
      let metaMessageId: string | null;
      if (claimed.kind === "charge_reminder") {
        metaMessageId = await sendPaymentReminderTemplate(
          eligible.recipient,
          chargeReminderPayloadSchema.parse(eligible.payload),
        );
      } else if (claimed.kind === "organizer_cycle_start") {
        metaMessageId = await sendOrganizerNewCycleTemplate(
          eligible.recipient,
          organizerCycleStartPayloadSchema.parse(eligible.payload),
        );
      } else {
        metaMessageId = await sendOrganizerListUpdateTemplate(
          eligible.recipient,
          organizerUpdatePayloadSchema.parse(eligible.payload),
        );
      }
      const sentAt = new Date();
      const [updated] = await db
        .update(whatsappNotifications)
        .set({
          status: "sent",
          recipientPhoneNormalized: eligible.recipient,
          payload: eligible.payload,
          metaMessageId,
          sentAt,
          updatedAt: sentAt,
          failedAt: null,
          errorCode: null,
        })
        .where(claimGuard(claimed))
        .returning({ id: whatsappNotifications.id });
      if (updated) sent += 1;
    } catch (error) {
      const failedAt = new Date();
      // Configuration is repairable without consuming a real delivery attempt.
      // Keep queued payment updates recoverable while the operator configures Meta.
      if (error instanceof WhatsappSendError && ["not_configured", "template_not_configured", "app_base_url_invalid", "configuration_invalid"].includes(error.code)) {
        if (await deferNotification(claimed, error.code, failedAt)) {
          failures.push({ notificationId: claimed.id, code: error.code });
        }
        continue;
      }
      const policy = failurePolicy(error);
      const exhausted = policy.retryable && claimed.attemptCount >= MAX_SEND_ATTEMPTS;
      const code = exhausted ? `${policy.code}_retry_exhausted` : policy.code;
      const retryable = policy.retryable && !exhausted;
      const [updated] = await db
        .update(whatsappNotifications)
        .set({
          status: "failed",
          failedAt,
          updatedAt: failedAt,
          nextAttemptAt: retryable
            ? new Date(failedAt.getTime() + retryDelayMs(claimed.attemptCount, policy.retryAfterMs))
            : DEAD_LETTER_AT,
          errorCode: code,
        })
        .where(claimGuard(claimed))
        .returning({ id: whatsappNotifications.id });
      if (updated) {
        console.error("CobraDora: falha ao enviar notificação WhatsApp", { notificationId: claimed.id, code });
        failures.push({ notificationId: claimed.id, code });
      }
    }
  }
  return { sent, skipped, failures };
}

type MetaDeliveryStatus = {
  id?: unknown;
  status?: unknown;
  timestamp?: unknown;
  errors?: { code?: unknown }[];
};

function extractMetaDeliveryStatuses(payload: unknown): MetaDeliveryStatus[] {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const statuses: MetaDeliveryStatus[] = [];
  for (const entry of entries) {
    const changes = entry && typeof entry === "object" ? (entry as { changes?: unknown }).changes : null;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change && typeof change === "object" ? (change as { value?: unknown }).value : null;
      const valueStatuses = value && typeof value === "object" ? (value as { statuses?: unknown }).statuses : null;
      if (Array.isArray(valueStatuses)) statuses.push(...valueStatuses);
    }
  }
  return statuses;
}

/** Atualiza sent/delivered/read/failed a partir do webhook oficial da Meta. */
export async function processWhatsappDeliveryStatuses(payload: unknown): Promise<{ updated: number }> {
  let updated = 0;
  for (const rawStatus of extractMetaDeliveryStatuses(payload)) {
    if (typeof rawStatus.id !== "string") continue;
    if (!['sent', 'delivered', 'read', 'failed'].includes(String(rawStatus.status))) continue;
    const status = rawStatus.status as "sent" | "delivered" | "read" | "failed";
    const parsedTimestamp = Number(rawStatus.timestamp);
    const occurredAt = Number.isFinite(parsedTimestamp) ? new Date(parsedTimestamp * 1000) : new Date();
    const errorCode = rawStatus.errors?.[0]?.code;
    const allowedCurrentStatuses = {
      sent: ["sent"],
      delivered: ["sent", "delivered"],
      read: ["sent", "delivered", "read"],
      failed: ["sent", "failed"],
    }[status] as (typeof whatsappNotifications.$inferSelect.status)[];
    const [row] = await db
      .update(whatsappNotifications)
      .set({
        status,
        ...(status === "sent" && {
          sentAt: sql`coalesce(${whatsappNotifications.sentAt}, ${occurredAt})`,
        }),
        ...(status === "delivered" && { deliveredAt: occurredAt }),
        ...(status === "read" && {
          readAt: occurredAt,
          deliveredAt: sql`coalesce(${whatsappNotifications.deliveredAt}, ${occurredAt})`,
        }),
        ...(status === "failed" && {
          failedAt: occurredAt,
          errorCode: typeof errorCode === "number" || typeof errorCode === "string" ? `meta_${errorCode}` : "meta_failed",
        }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappNotifications.metaMessageId, rawStatus.id),
          inArray(whatsappNotifications.status, allowedCurrentStatuses),
        ),
      )
      .returning({ id: whatsappNotifications.id });
    if (row) updated += 1;
  }
  return { updated };
}
