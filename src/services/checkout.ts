import { createHash } from "node:crypto";
import { db } from "@/db";
import {
  groups,
  organizations,
  financialContacts,
  participants,
  charges,
  billingPeriods,
  checkoutSessions,
  checkoutItems,
  gatewayAccounts,
} from "@/db/schema";
import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { getPaymentsAdapter } from "@/payments";
import { InfinitePayCheckoutRequestError } from "@/payments/infinitepay-adapter";
import { deriveCheckoutToken, hashCheckoutToken } from "@/payments/session-tokens";
import { normalizePhoneBR } from "@/lib/phone";

const SESSION_TTL_MS = 15 * 60 * 1000;
const CREATION_IN_FLIGHT_MS = 20_000;

export type PublicCheckoutErrorCode =
  | "group_not_found"
  | "contact_not_found"
  | "gateway_not_configured"
  | "charges_unavailable"
  | "idempotency_conflict"
  | "checkout_in_progress"
  | "checkout_reconciliation_required"
  | "checkout_already_completed"
  | "checkout_temporarily_unavailable";

export class PublicCheckoutError extends Error {
  constructor(
    readonly code: PublicCheckoutErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PublicCheckoutError";
  }
}

function normalizeAndValidatePhone(rawPhone: string): string {
  try {
    const normalized = normalizePhoneBR(rawPhone);
    if (/^\+55[1-9][0-9]9[0-9]{8}$/.test(normalized)) return normalized;
  } catch {
    // A resposta pública abaixo é deliberadamente uniforme.
  }
  throw new PublicCheckoutError("contact_not_found", "Telefone inválido ou não encontrado", 404);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function referenceMonthLabel(referenceMonth: string): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "[modalidade] · [organização] · [competência]" — cada parte omitida se vazia. */
function buildCheckoutItemDescription(input: {
  sport: string | null;
  organizationName: string;
  referenceMonths: string[];
}): string {
  const competencia = [...new Set(input.referenceMonths)].map(referenceMonthLabel).join(", ");
  return [input.sport?.trim(), input.organizationName.trim(), competencia].filter(Boolean).join(" · ");
}

function stableChargeIds(chargeIds: string[]): string[] {
  return [...new Set(chargeIds)].sort();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

function requestFingerprint(groupId: string, financialContactId: string, chargeIds: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ groupId, financialContactId, chargeIds: stableChargeIds(chargeIds) }))
    .digest("hex");
}

function sameIds(left: string[], right: string[]): boolean {
  const a = stableChargeIds(left);
  const b = stableChargeIds(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

type Session = typeof checkoutSessions.$inferSelect;
type SelectedCharge = {
  id: string;
  participantId: string;
  financialContactId: string;
  groupId: string;
  totalAmount: number;
  status: typeof charges.$inferSelect.status;
  referenceMonth: string;
};

async function loadSessionItems(sessionId: string) {
  return db.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, sessionId));
}

async function sessionMatchesRequest(
  session: Session,
  responsibleParticipantId: string,
  financialContactId: string,
  fingerprint: string,
  chargeIds: string[],
): Promise<boolean> {
  if (
    session.participantId !== responsibleParticipantId ||
    session.financialContactId !== financialContactId ||
    (session.requestFingerprint && session.requestFingerprint !== fingerprint)
  ) {
    return false;
  }
  const items = await loadSessionItems(session.id);
  return sameIds(items.map((item) => item.chargeId), chargeIds);
}

type CheckoutResultValue = {
  checkoutSessionId: string;
  checkoutUrl: string;
  totalChargesAmount: number;
  payerName: string;
  resumed: boolean;
  recovered?: "resumed_previous" | "started_new";
};

function checkoutResult(session: Session, items: { amount: number }[], payerName: string, resumed: boolean): CheckoutResultValue {
  if (!session.checkoutUrl || session.expiresAt.getTime() <= Date.now()) {
    throw new PublicCheckoutError("checkout_in_progress", "O checkout ainda está sendo preparado. Tente novamente.", 409);
  }
  return {
    checkoutSessionId: session.id,
    checkoutUrl: session.checkoutUrl,
    totalChargesAmount: items.reduce((sum, item) => sum + item.amount, 0),
    payerName,
    resumed,
  };
}

function requiresReconciliation(session: Session): boolean {
  return (
    session.externalCreationState === "in_flight" ||
    session.externalCreationState === "ambiguous" ||
    session.externalCreationState === "linked" ||
    Boolean(session.checkoutUrl) ||
    Boolean(session.gatewayCheckoutId)
  );
}

function reconciliationRequired(): never {
  throw new PublicCheckoutError(
    "checkout_reconciliation_required",
    "Esta tentativa precisa ser reconciliada antes de iniciar outro checkout.",
    409,
  );
}

/**
 * Aplica o TTL sob lock. Uma reserva que seguramente nunca saiu do banco
 * (`not_started`) pode ser liberada. Um link conhecido também deixa de ser
 * devolvido e a cobrança volta a ficar disponível, mas a sessão continua
 * como bloqueio de reconciliação para impedir um segundo link sobre os mesmos
 * itens. Já uma chamada ambígua nunca é liberada automaticamente: não sabemos
 * se o provedor recebeu o POST.
 */
async function expireSessionIfNeeded(candidate: Session, now = new Date()): Promise<Session> {
  if (
    candidate.expiresAt.getTime() > now.getTime() ||
    candidate.status === "completed" ||
    candidate.status === "canceled" ||
    candidate.status === "expired"
  ) {
    return candidate;
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from checkout_sessions where id = ${candidate.id} for update`);
    const [current] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, candidate.id));
    if (
      !current ||
      current.expiresAt.getTime() > now.getTime() ||
      current.status === "completed" ||
      current.status === "canceled" ||
      current.status === "expired"
    ) {
      return current ?? candidate;
    }

    const ambiguous =
      current.externalCreationState === "in_flight" || current.externalCreationState === "ambiguous";
    const [expired] = await tx
      .update(checkoutSessions)
      .set({
        status: "expired",
        externalCreationState: ambiguous ? "ambiguous" : current.externalCreationState,
      })
      .where(
        and(
          eq(checkoutSessions.id, current.id),
          inArray(checkoutSessions.status, ["created", "pending"]),
          lte(checkoutSessions.expiresAt, now),
        ),
      )
      .returning();
    if (!expired) return current;

    if (!ambiguous) {
      const items = await tx.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, current.id));
      if (items.length > 0) {
        await tx
          .update(charges)
          .set({ status: "open", updatedAt: now })
          .where(and(inArray(charges.id, items.map((item) => item.chargeId)), eq(charges.status, "checkout_pending")));
      }
    }
    return expired;
  });
}

export async function expireStaleCheckoutSessions(
  now = new Date(),
  limit = 500,
): Promise<{ expired: number; released: number; awaitingReconciliation: number }> {
  const candidates = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        inArray(checkoutSessions.status, ["created", "pending"]),
        lte(checkoutSessions.expiresAt, now),
      ),
    )
    .orderBy(checkoutSessions.expiresAt)
    .limit(limit);

  let expired = 0;
  let released = 0;
  let awaitingReconciliation = 0;
  for (const candidate of candidates) {
    const wasAmbiguous =
      candidate.externalCreationState === "in_flight" || candidate.externalCreationState === "ambiguous";
    const result = await expireSessionIfNeeded(candidate, now);
    if (result.status !== "expired") continue;
    expired += 1;
    if (wasAmbiguous) awaitingReconciliation += 1;
    else released += 1;
  }
  return { expired, released, awaitingReconciliation };
}

async function markStaleInFlightAsAmbiguous(session: Session): Promise<Session> {
  if (session.externalCreationState !== "in_flight") return session;
  const startedAt = session.externalRequestStartedAt ?? session.createdAt;
  if (Date.now() - startedAt.getTime() < CREATION_IN_FLIGHT_MS) return session;

  const [updated] = await db
    .update(checkoutSessions)
    .set({ externalCreationState: "ambiguous" })
    .where(
      and(
        eq(checkoutSessions.id, session.id),
        eq(checkoutSessions.status, "created"),
        eq(checkoutSessions.externalCreationState, "in_flight"),
      ),
    )
    .returning();
  return updated ?? session;
}

type ReusableSessionDecision =
  | { kind: "return"; value: ReturnType<typeof checkoutResult> }
  | { kind: "create"; session: Session }
  | { kind: "ignore" };

async function decideReusableSession(candidate: Session, payerName: string): Promise<ReusableSessionDecision> {
  let current = await expireSessionIfNeeded(candidate);

  if (current.status === "completed") {
    throw new PublicCheckoutError("checkout_already_completed", "Este checkout já foi concluído", 409);
  }
  if (current.status === "expired") {
    if (requiresReconciliation(current)) reconciliationRequired();
    return { kind: "ignore" };
  }
  if (current.status === "canceled") return { kind: "ignore" };

  if (current.checkoutUrl) {
    if (current.status === "created" || current.externalCreationState !== "linked") {
      const [linked] = await db
        .update(checkoutSessions)
        .set({ status: "pending", externalCreationState: "linked" })
        .where(
          and(
            eq(checkoutSessions.id, current.id),
            inArray(checkoutSessions.status, ["created", "pending"]),
            gt(checkoutSessions.expiresAt, new Date()),
          ),
        )
        .returning();
      if (linked) current = linked;
    }
    return {
      kind: "return",
      value: checkoutResult(current, await loadSessionItems(current.id), payerName, true),
    };
  }

  if (current.externalCreationState === "in_flight") {
    current = await markStaleInFlightAsAmbiguous(current);
    if (current.externalCreationState === "in_flight") {
      throw new PublicCheckoutError("checkout_in_progress", "O checkout ainda está sendo preparado. Tente novamente.", 409);
    }
  }
  if (
    current.status === "pending" ||
    current.externalCreationState === "ambiguous" ||
    current.externalCreationState === "linked"
  ) {
    reconciliationRequired();
  }
  if (current.status === "created" && current.externalCreationState === "not_started") {
    return { kind: "create", session: current };
  }
  return { kind: "ignore" };
}

async function findCompatibleRecoverableSession(
  organizationId: string,
  responsibleParticipantId: string,
  financialContactId: string,
  fingerprint: string,
  chargeIds: string[],
): Promise<Session | null> {
  const candidates = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.organizationId, organizationId),
        eq(checkoutSessions.participantId, responsibleParticipantId),
        eq(checkoutSessions.financialContactId, financialContactId),
        eq(checkoutSessions.gateway, "infinitepay"),
        inArray(checkoutSessions.status, ["created", "pending", "expired"]),
      ),
    )
    .orderBy(desc(checkoutSessions.createdAt))
    .limit(10);

  for (const rawCandidate of candidates) {
    const candidate = await expireSessionIfNeeded(rawCandidate);
    if (
      (await sessionMatchesRequest(candidate, responsibleParticipantId, financialContactId, fingerprint, chargeIds)) &&
      (candidate.status !== "expired" || requiresReconciliation(candidate))
    ) {
      return candidate;
    }
  }
  return null;
}

/** Impede novo checkout parcial/superset quando qualquer item ainda pode
 * pertencer a uma criação externa anterior. O fingerprint exato não basta:
 * um novo pedido poderia selecionar apenas parte do checkout antigo. */
async function findOverlappingBlockingSession(
  organizationId: string,
  chargeIds: string[],
  excludeSessionId?: string,
): Promise<Session | null> {
  const candidates = await db
    .select({ session: checkoutSessions })
    .from(checkoutSessions)
    .innerJoin(checkoutItems, eq(checkoutItems.checkoutSessionId, checkoutSessions.id))
    .where(
      and(
        eq(checkoutSessions.organizationId, organizationId),
        inArray(checkoutSessions.status, ["created", "pending", "expired"]),
        inArray(checkoutItems.chargeId, chargeIds),
      ),
    )
    .orderBy(desc(checkoutSessions.createdAt));

  const seen = new Set<string>();
  for (const row of candidates) {
    if (row.session.id === excludeSessionId || seen.has(row.session.id)) continue;
    seen.add(row.session.id);
    const candidate = await expireSessionIfNeeded(row.session);
    if (candidate.status === "created" || candidate.status === "pending") return candidate;
    if (candidate.status === "expired" && requiresReconciliation(candidate)) return candidate;
  }
  return null;
}

async function cancelSessionAndReleaseCharges(sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from checkout_sessions where id = ${sessionId} for update`);
    const [session] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    if (
      !session ||
      session.status !== "created" ||
      !["not_started", "in_flight"].includes(session.externalCreationState)
    ) return;

    const items = await tx.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, sessionId));
    await tx
      .update(checkoutSessions)
      .set({ status: "canceled", externalCreationState: "not_started" })
      .where(eq(checkoutSessions.id, sessionId));

    if (items.length > 0) {
      await tx
        .update(charges)
        .set({ status: "open", updatedAt: new Date() })
        .where(and(inArray(charges.id, items.map((item) => item.chargeId)), eq(charges.status, "checkout_pending")));
    }
  });
}

/**
 * Reabre localmente uma sessão que expirou por TTL mas cujo link é
 * confirmadamente real (checkoutUrl != null) — não há ambiguidade nenhuma
 * aqui, só a nossa janela de reserva local que passou. Renova o TTL e volta
 * pro estado "pending"/"linked" em vez de criar uma sessão concorrente.
 */
async function resumeKnownLinkSession(sessionId: string): Promise<Session | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from checkout_sessions where id = ${sessionId} for update`);
    const [session] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    if (!session || !session.checkoutUrl || !["created", "pending", "expired"].includes(session.status)) return null;

    const items = await tx.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, sessionId));
    if (items.length > 0) {
      const itemChargeIds = items.map((item) => item.chargeId);
      const currentCharges = await tx
        .select({ id: charges.id, status: charges.status })
        .from(charges)
        .where(inArray(charges.id, itemChargeIds));
      // Se alguma cobrança já mudou de estado por fora (baixa manual,
      // cancelamento) desde que a sessão expirou, não reaproveita — a
      // reconciliação segue bloqueada e o participante cai no fluxo normal.
      if (
        currentCharges.length !== items.length ||
        currentCharges.some((charge) => charge.status !== "open" && charge.status !== "checkout_pending")
      ) {
        return null;
      }
      await tx
        .update(charges)
        .set({ status: "checkout_pending", updatedAt: new Date() })
        .where(and(inArray(charges.id, itemChargeIds), eq(charges.status, "open")));
    }

    const [resumed] = await tx
      .update(checkoutSessions)
      .set({ status: "pending", externalCreationState: "linked", expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(checkoutSessions.id, sessionId))
      .returning();
    return resumed ?? null;
  });
}

/**
 * Só usada pelo fluxo explícito de "gerar novo link" do participante: cancela
 * uma sessão travada em reconciliação (ambiguous/in_flight/linked) SEM
 * checkoutUrl conhecido e libera as cobranças. Ao contrário de
 * `cancelSessionAndReleaseCharges` (automática, só em estados 100% seguros),
 * aqui é uma decisão explícita do participante assumindo o pequeno risco de
 * existir um link antigo que a InfinitePay tenha criado sem nossa confirmação.
 */
async function cancelBlockedSessionAndReleaseCharges(
  sessionId: string,
  options?: { forceEvenWithKnownLink?: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from checkout_sessions where id = ${sessionId} for update`);
    const [session] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    if (
      !session ||
      (!options?.forceEvenWithKnownLink && session.checkoutUrl) ||
      !["created", "pending", "expired"].includes(session.status)
    ) return;

    const items = await tx.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, sessionId));
    await tx.update(checkoutSessions).set({ status: "canceled" }).where(eq(checkoutSessions.id, sessionId));

    if (items.length > 0) {
      await tx
        .update(charges)
        .set({ status: "open", updatedAt: new Date() })
        .where(and(inArray(charges.id, items.map((item) => item.chargeId)), eq(charges.status, "checkout_pending")));
    }
  });
}

/**
 * Ponto de entrada do botão admin "Liberar cobrança" (cobranças presas em
 * "Em conciliação"/checkout_pending, sem nenhuma ação disponível hoje). Ao
 * contrário do fluxo público (que preserva um link conhecido quando existe,
 * pra não descartar um checkout ainda válido), aqui o admin está pedindo
 * explicitamente pra destravar a cobrança e assumir o controle manual — libera
 * mesmo que a sessão tenha um checkoutUrl conhecido, porque a intenção é dar
 * baixa ou cancelar manualmente em seguida, não continuar o checkout.
 */
export async function releaseStuckCheckoutForCharge(organizationId: string, chargeId: string): Promise<void> {
  const [charge] = await db
    .select({ id: charges.id, status: charges.status })
    .from(charges)
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .innerJoin(groups, eq(billingPeriods.groupId, groups.id))
    .where(and(eq(charges.id, chargeId), eq(groups.organizationId, organizationId)));
  if (!charge) throw new Error("Cobrança não encontrada");
  if (charge.status !== "checkout_pending") return;

  const blocking = await findOverlappingBlockingSession(organizationId, [chargeId]);
  if (!blocking) return;

  await cancelBlockedSessionAndReleaseCharges(blocking.id, { forceEvenWithKnownLink: true });
}

/**
 * Ponto de entrada do botão "gerar novo link de pagamento": resolve uma
 * sessão bloqueadora automaticamente quando é seguro (link conhecido →
 * reaproveita, sem criar nada novo) e só assume risco (cancela e libera as
 * cobranças pra uma sessão nova ser criada) quando genuinamente não há como
 * saber o que aconteceu com a tentativa anterior. Ignora sessões que não
 * estão de fato travadas (uma reserva ativa normal de outra aba, por
 * exemplo) — essas continuam bloqueando checkout_in_progress como hoje.
 */
async function tryResolveBlockedSession(
  organizationId: string,
  chargeIds: string[],
  payerName: string,
): Promise<{ resumed: ReturnType<typeof checkoutResult> | null; reset: boolean }> {
  const blocking = await findOverlappingBlockingSession(organizationId, chargeIds);
  if (!blocking || (!requiresReconciliation(blocking) && blocking.status !== "expired")) {
    return { resumed: null, reset: false };
  }

  if (blocking.checkoutUrl) {
    const resumedSession = await resumeKnownLinkSession(blocking.id);
    if (!resumedSession) return { resumed: null, reset: false };
    return {
      resumed: checkoutResult(resumedSession, await loadSessionItems(resumedSession.id), payerName, true),
      reset: false,
    };
  }

  await cancelBlockedSessionAndReleaseCharges(blocking.id);
  return { resumed: null, reset: true };
}

async function reviveCanceledSession(
  session: Session,
  selectedCharges: SelectedCharge[],
  gatewayAccount: { id: string; externalAccountId: string },
): Promise<Session> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from checkout_sessions where id = ${session.id} for update`);
    const [current] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, session.id));
    if (
      !current ||
      current.status !== "canceled" ||
      current.checkoutUrl ||
      requiresReconciliation(current)
    ) {
      throw new PublicCheckoutError("idempotency_conflict", "Esta tentativa de checkout não pode ser reutilizada", 409);
    }

    const participantIds = [...new Set([session.participantId, ...selectedCharges.map((charge) => charge.participantId)])].sort();
    await tx.execute(sql`select id from participants where id in ${participantIds} order by id for key share`);
    const currentParticipants = await tx
      .select({
        id: participants.id,
        financialContactId: participants.financialContactId,
        financialRole: participants.financialRole,
      })
      .from(participants)
      .where(inArray(participants.id, participantIds));
    if (
      currentParticipants.length !== participantIds.length ||
      currentParticipants.some((participant) => participant.financialContactId !== session.financialContactId) ||
      !currentParticipants.some(
        (participant) => participant.id === session.participantId && participant.financialRole === "responsible",
      )
    ) {
      throw new PublicCheckoutError("charges_unavailable", "O contato financeiro mudou durante o checkout", 409);
    }

    const claimed = await tx
      .update(charges)
      .set({ status: "checkout_pending", updatedAt: new Date() })
      .where(and(inArray(charges.id, selectedCharges.map((charge) => charge.id)), eq(charges.status, "open")))
      .returning();
    if (claimed.length !== selectedCharges.length) {
      throw new PublicCheckoutError("charges_unavailable", "Uma ou mais cobranças não estão disponíveis", 409);
    }
    const expectedAmounts = new Map(selectedCharges.map((charge) => [charge.id, charge.totalAmount]));
    if (claimed.some((charge) => expectedAmounts.get(charge.id) !== charge.totalAmount)) {
      throw new PublicCheckoutError(
        "charges_unavailable",
        "O valor de uma ou mais cobranças mudou. Atualize a página antes de continuar.",
        409,
      );
    }

    await tx.delete(checkoutItems).where(eq(checkoutItems.checkoutSessionId, session.id));
    await tx.insert(checkoutItems).values(
      claimed.map((charge) => ({
        checkoutSessionId: session.id,
        chargeId: charge.id,
        amount: charge.totalAmount,
      })),
    );

    const webhookTokenHash = hashCheckoutToken(deriveCheckoutToken(session.id, "webhook"));
    const recoveryTokenHash = hashCheckoutToken(deriveCheckoutToken(session.id, "recovery"));
    const [revived] = await tx
      .update(checkoutSessions)
      .set({
        status: "created",
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        gatewayCheckoutId: null,
        gatewayPaymentId: null,
        gatewayInvoiceSlug: null,
        checkoutUrl: null,
        gatewayAccountId: gatewayAccount.id,
        gatewayExternalAccountIdSnapshot: gatewayAccount.externalAccountId,
        externalCreationState: "not_started",
        externalRequestStartedAt: null,
        webhookTokenHash,
        recoveryTokenHash,
      })
      .where(eq(checkoutSessions.id, session.id))
      .returning();
    return revived;
  });
}

async function createReservedSession(input: {
  organizationId: string;
  responsibleParticipantId: string;
  financialContactId: string;
  idempotencyKey: string;
  fingerprint: string;
  selectedCharges: SelectedCharge[];
  gatewayAccountId: string;
  gatewayExternalAccountId: string;
}): Promise<Session> {
  return db.transaction(async (tx) => {
    const participantIds = [...new Set([
      input.responsibleParticipantId,
      ...input.selectedCharges.map((charge) => charge.participantId),
    ])].sort();
    // Serializa a troca de contato com a reserva. updateParticipant usa FOR
    // UPDATE; esta leitura compartilhada garante que nenhum dos lados grave
    // uma sessão apontando para o contato antigo numa corrida concorrente.
    await tx.execute(sql`select id from participants where id in ${participantIds} order by id for key share`);
    const currentParticipants = await tx
      .select({
        id: participants.id,
        financialContactId: participants.financialContactId,
        financialRole: participants.financialRole,
      })
      .from(participants)
      .where(inArray(participants.id, participantIds));
    if (
      currentParticipants.length !== participantIds.length ||
      currentParticipants.some((participant) => participant.financialContactId !== input.financialContactId) ||
      !currentParticipants.some(
        (participant) =>
          participant.id === input.responsibleParticipantId && participant.financialRole === "responsible",
      )
    ) {
      throw new PublicCheckoutError("charges_unavailable", "O contato financeiro mudou durante o checkout", 409);
    }

    const [session] = await tx
      .insert(checkoutSessions)
      .values({
        organizationId: input.organizationId,
        participantId: input.responsibleParticipantId,
        financialContactId: input.financialContactId,
        gateway: "infinitepay",
        status: "created",
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.fingerprint,
        gatewayAccountId: input.gatewayAccountId,
        gatewayExternalAccountIdSnapshot: input.gatewayExternalAccountId,
        externalCreationState: "not_started",
      })
      .returning();

    const webhookToken = deriveCheckoutToken(session.id, "webhook");
    const recoveryToken = deriveCheckoutToken(session.id, "recovery");
    await tx
      .update(checkoutSessions)
      .set({
        webhookTokenHash: hashCheckoutToken(webhookToken),
        recoveryTokenHash: hashCheckoutToken(recoveryToken),
      })
      .where(eq(checkoutSessions.id, session.id));

    const claimed = await tx
      .update(charges)
      .set({ status: "checkout_pending", updatedAt: new Date() })
      .where(and(inArray(charges.id, input.selectedCharges.map((charge) => charge.id)), eq(charges.status, "open")))
      .returning();
    if (claimed.length !== input.selectedCharges.length) {
      throw new PublicCheckoutError("charges_unavailable", "Uma ou mais cobranças não estão disponíveis", 409);
    }
    const expectedAmounts = new Map(input.selectedCharges.map((charge) => [charge.id, charge.totalAmount]));
    if (claimed.some((charge) => expectedAmounts.get(charge.id) !== charge.totalAmount)) {
      throw new PublicCheckoutError(
        "charges_unavailable",
        "O valor de uma ou mais cobranças mudou. Atualize a página antes de continuar.",
        409,
      );
    }

    await tx.insert(checkoutItems).values(
      claimed.map((charge) => ({
        checkoutSessionId: session.id,
        chargeId: charge.id,
        amount: charge.totalAmount,
      })),
    );

    return {
      ...session,
      webhookTokenHash: hashCheckoutToken(webhookToken),
      recoveryTokenHash: hashCheckoutToken(recoveryToken),
    };
  });
}

/**
 * Compare-and-set que concede a uma única requisição o direito de executar o
 * POST externo. Também renova hashes determinísticos e snapshots antes de
 * qualquer byte sair do processo, cobrindo sessões legadas/revividas.
 */
async function startExternalCreation(
  session: Session,
  gatewayAccount: { id: string; externalAccountId: string },
): Promise<Session> {
  const now = new Date();
  const [started] = await db
    .update(checkoutSessions)
    .set({
      gatewayAccountId: gatewayAccount.id,
      gatewayExternalAccountIdSnapshot: gatewayAccount.externalAccountId,
      webhookTokenHash: hashCheckoutToken(deriveCheckoutToken(session.id, "webhook")),
      recoveryTokenHash: hashCheckoutToken(deriveCheckoutToken(session.id, "recovery")),
      externalCreationState: "in_flight",
      externalRequestStartedAt: now,
    })
    .where(
      and(
        eq(checkoutSessions.id, session.id),
        eq(checkoutSessions.status, "created"),
        eq(checkoutSessions.externalCreationState, "not_started"),
        gt(checkoutSessions.expiresAt, now),
      ),
    )
    .returning();

  if (started) return started;

  const [current] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, session.id));
  if (current) {
    const refreshed = await expireSessionIfNeeded(current, now);
    if (refreshed.externalCreationState === "in_flight") {
      throw new PublicCheckoutError("checkout_in_progress", "O checkout ainda está sendo preparado. Tente novamente.", 409);
    }
    if (requiresReconciliation(refreshed)) reconciliationRequired();
  }
  throw new PublicCheckoutError("idempotency_conflict", "Esta tentativa de checkout não pode ser reutilizada", 409);
}

async function markExternalCreationAmbiguous(sessionId: string): Promise<void> {
  await db
    .update(checkoutSessions)
    .set({ externalCreationState: "ambiguous" })
    .where(
      and(
        eq(checkoutSessions.id, sessionId),
        eq(checkoutSessions.status, "created"),
        eq(checkoutSessions.externalCreationState, "in_flight"),
      ),
    );
}

async function createExternalCheckout(input: {
  session: Session;
  organizationId: string;
  responsibleParticipantId: string;
  responsibleName: string;
  phoneNormalized: string;
  gatewayAccount: { id: string; externalAccountId: string };
  totalAmount: number;
  idempotencyKey: string;
  itemDescription: string;
}) {
  const startedSession = await startExternalCreation(input.session, input.gatewayAccount);
  const webhookToken = deriveCheckoutToken(input.session.id, "webhook");
  const recoveryToken = deriveCheckoutToken(input.session.id, "recovery");

  try {
    const result = await getPaymentsAdapter("infinitepay").createCheckout({
      organizationId: input.organizationId,
      participantId: input.responsibleParticipantId,
      amount: input.totalAmount,
      splits: [],
      dueDate: today(),
      idempotencyKey: input.idempotencyKey,
      gatewayExternalAccountId: startedSession.gatewayExternalAccountIdSnapshot ?? input.gatewayAccount.externalAccountId,
      externalReference: input.session.id,
      webhookToken,
      recoveryToken,
      buyerName: input.responsibleName,
      buyerPhone: input.phoneNormalized,
      description: input.itemDescription,
    });

    const [linked] = await db
      .update(checkoutSessions)
      .set({
        gatewayCheckoutId: result.gatewayCheckoutId,
        checkoutUrl: result.checkoutUrl,
        status: "pending",
        externalCreationState: "linked",
      })
      .where(
        and(
          eq(checkoutSessions.id, input.session.id),
          eq(checkoutSessions.status, "created"),
          eq(checkoutSessions.externalCreationState, "in_flight"),
        ),
      )
      .returning();
    if (!linked) {
      throw new InfinitePayCheckoutRequestError(
        "A criação externa foi concluída, mas o vínculo local não pôde ser confirmado",
        true,
      );
    }

    return result.checkoutUrl;
  } catch (error) {
    console.error("Checkout InfinitePay: criação externa falhou", {
      sessionId: input.session.id,
      mayHaveSucceeded: error instanceof InfinitePayCheckoutRequestError ? error.mayHaveSucceeded : null,
      status: error instanceof InfinitePayCheckoutRequestError ? error.status : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof InfinitePayCheckoutRequestError && !error.mayHaveSucceeded) {
      await cancelSessionAndReleaseCharges(input.session.id);
    } else {
      await markExternalCreationAmbiguous(input.session.id);
    }
    throw new PublicCheckoutError(
      "checkout_temporarily_unavailable",
      "Não foi possível preparar o checkout agora. Tente novamente em alguns instantes.",
      503,
    );
  }
}

export async function createCheckoutForCharges(
  groupPublicSlug: string,
  rawPhone: string,
  chargeIds: string[],
  idempotencyKey: string,
  resetBlocked = false,
): Promise<CheckoutResultValue> {
  const uniqueChargeIds = stableChargeIds(chargeIds);
  if (uniqueChargeIds.length === 0 || uniqueChargeIds.length !== chargeIds.length) {
    throw new PublicCheckoutError("charges_unavailable", "A seleção de cobranças é inválida", 400);
  }

  const [group] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.publicSlug, groupPublicSlug), eq(groups.status, "active")));
  if (!group) throw new PublicCheckoutError("group_not_found", "Grupo não encontrado", 404);

  const [organization] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, group.organizationId));

  const phoneNormalized = normalizeAndValidatePhone(rawPhone);
  const [financialContact] = await db
    .select()
    .from(financialContacts)
    .where(
      and(
        eq(financialContacts.organizationId, group.organizationId),
        eq(financialContacts.phoneNormalized, phoneNormalized),
      ),
    );
  if (!financialContact) {
    throw new PublicCheckoutError("contact_not_found", "Telefone inválido ou não encontrado", 404);
  }

  const [responsible] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.organizationId, group.organizationId),
        eq(participants.financialContactId, financialContact.id),
        eq(participants.financialRole, "responsible"),
      ),
    );
  if (!responsible) throw new PublicCheckoutError("contact_not_found", "Telefone inválido ou não encontrado", 404);

  const [gatewayAccount] = await db
    .select()
    .from(gatewayAccounts)
    .where(
      and(
        eq(gatewayAccounts.organizationId, group.organizationId),
        eq(gatewayAccounts.provider, "infinitepay"),
        eq(gatewayAccounts.status, "active"),
      ),
    );
  if (!gatewayAccount) {
    throw new PublicCheckoutError("gateway_not_configured", "Pagamento online indisponível para esta organização", 409);
  }

  let resetHappened = false;
  if (resetBlocked) {
    const resolution = await tryResolveBlockedSession(group.organizationId, uniqueChargeIds, responsible.name);
    if (resolution.resumed) return { ...resolution.resumed, recovered: "resumed_previous" as const };
    resetHappened = resolution.reset;
  }

  const selectedCharges = await db
    .select({
      id: charges.id,
      participantId: charges.participantId,
      financialContactId: participants.financialContactId,
      groupId: billingPeriods.groupId,
      totalAmount: charges.totalAmount,
      status: charges.status,
      referenceMonth: billingPeriods.referenceMonth,
    })
    .from(charges)
    .innerJoin(participants, eq(charges.participantId, participants.id))
    .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id))
    .where(inArray(charges.id, uniqueChargeIds));

  const selectionIsValid =
    selectedCharges.length === uniqueChargeIds.length &&
    selectedCharges.every(
      (charge) =>
        charge.groupId === group.id &&
        charge.financialContactId === financialContact.id &&
        (charge.status === "open" || charge.status === "checkout_pending") &&
        Number.isInteger(charge.totalAmount) &&
        charge.totalAmount > 0,
    );
  if (!selectionIsValid) {
    throw new PublicCheckoutError("charges_unavailable", "Uma ou mais cobranças não estão disponíveis", 409);
  }

  const fingerprint = requestFingerprint(group.id, financialContact.id, uniqueChargeIds);
  const [sameKeySession] = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.organizationId, group.organizationId),
        eq(checkoutSessions.idempotencyKey, idempotencyKey),
      ),
    );

  let session: Session | null = null;
  let resumed = false;

  if (sameKeySession) {
    if (!(await sessionMatchesRequest(sameKeySession, responsible.id, financialContact.id, fingerprint, uniqueChargeIds))) {
      throw new PublicCheckoutError(
        "idempotency_conflict",
        "A chave de idempotência já foi usada para outra seleção",
        409,
      );
    }
    const currentSameKeySession = await expireSessionIfNeeded(sameKeySession);
    if (currentSameKeySession.status === "canceled") {
      if (!selectedCharges.every((charge) => charge.status === "open")) {
        throw new PublicCheckoutError("charges_unavailable", "Uma ou mais cobranças não estão disponíveis", 409);
      }
      session = await reviveCanceledSession(currentSameKeySession, selectedCharges, gatewayAccount);
      resumed = true;
    } else {
      const decision = await decideReusableSession(currentSameKeySession, responsible.name);
      if (decision.kind === "return") return decision.value;
      if (decision.kind === "create") {
        session = decision.session;
        resumed = true;
      } else {
        throw new PublicCheckoutError("idempotency_conflict", "Esta tentativa de checkout expirou", 409);
      }
    }
  }

  if (!session) {
    const compatible = await findCompatibleRecoverableSession(
      group.organizationId,
      responsible.id,
      financialContact.id,
      fingerprint,
      uniqueChargeIds,
    );
    if (compatible) {
      const decision = await decideReusableSession(compatible, responsible.name);
      if (decision.kind === "return") return decision.value;
      if (decision.kind === "create") {
        session = decision.session;
        resumed = true;
      }
    }
  }

  if (!session) {
    const overlapping = await findOverlappingBlockingSession(group.organizationId, uniqueChargeIds);
    if (overlapping) {
      if (requiresReconciliation(overlapping) || overlapping.status === "expired") reconciliationRequired();
      throw new PublicCheckoutError(
        "checkout_in_progress",
        "Uma ou mais cobranças já pertencem a outro checkout em preparação.",
        409,
      );
    }
  }

  if (!session) {
    if (!selectedCharges.every((charge) => charge.status === "open")) {
      throw new PublicCheckoutError(
        "charges_unavailable",
        "Estas cobranças já pertencem a outro checkout. Selecione exatamente as cobranças reservadas para retomá-lo.",
        409,
      );
    }
    try {
      session = await createReservedSession({
        organizationId: group.organizationId,
        responsibleParticipantId: responsible.id,
        financialContactId: financialContact.id,
        idempotencyKey,
        fingerprint,
        selectedCharges,
        gatewayAccountId: gatewayAccount.id,
        gatewayExternalAccountId: gatewayAccount.externalAccountId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PublicCheckoutError("checkout_in_progress", "O checkout ainda está sendo preparado. Tente novamente.", 409);
      }
      throw error;
    }
  }

  const items = await loadSessionItems(session.id);
  const totalChargesAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const itemDescription = buildCheckoutItemDescription({
    sport: group.sport,
    organizationName: organization?.name ?? "",
    referenceMonths: selectedCharges.map((charge) => charge.referenceMonth),
  });
  const checkoutUrl = await createExternalCheckout({
    session,
    organizationId: group.organizationId,
    responsibleParticipantId: responsible.id,
    responsibleName: responsible.name,
    phoneNormalized: financialContact.phoneNormalized,
    gatewayAccount,
    itemDescription,
    totalAmount: totalChargesAmount,
    idempotencyKey: session.idempotencyKey,
  });

  return {
    checkoutSessionId: session.id,
    checkoutUrl,
    totalChargesAmount,
    payerName: responsible.name,
    resumed,
    ...(resetHappened && { recovered: "started_new" as const }),
  };
}
