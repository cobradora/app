import { createHash } from "node:crypto";
import { db } from "@/db";
import {
  webhookEvents,
  checkoutSessions,
  checkoutItems,
  payments,
  paymentAllocations,
  charges,
  auditEvents,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getPaymentsAdapter } from "@/payments";

/**
 * Lancada quando `adapter.validateWebhook` rejeita o par (rawBody, token) —
 * ou porque o token nao bate com o webhookTokenHash da sessao, ou porque a
 * sessao referenciada pelo order_nsu do payload nem existe (o adapter real
 * faz o lookup e retorna false nos dois casos, ja que o segredo e por
 * sessao).
 */
export class InvalidWebhookSignatureError extends Error {
  constructor(message = "Assinatura/token do webhook InfinitePay inválido") {
    super(message);
    this.name = "InvalidWebhookSignatureError";
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

type InfinitePayRawPayload = {
  order_nsu?: unknown;
  transaction_nsu?: unknown;
  amount?: unknown;
  capture_method?: unknown;
};

/**
 * Processa um webhook de confirmacao de pagamento da InfinitePay.
 *
 * Modelo de confianca (mesmo do portal-de-torcida, decisao ja confirmada
 * para esta fase): so confiamos no conteudo financeiro do payload DEPOIS de
 * validar (a) o segredo por sessao via adapter.validateWebhook() e (b) o
 * valor batendo exatamente com a soma dos checkoutItems da sessao. Nao ha
 * fallback via adapter.getPayment()/payment_check nesta fase.
 *
 * Idempotencia em duas camadas:
 * 1. webhook_events (provider, external_event_id) unique — uma segunda
 *    entrega do mesmo transaction_nsu retorna { alreadyProcessed: true }
 *    sem reprocessar nada.
 * 2. payments.gateway_payment_id unique — rede de seguranca para corridas
 *    entre duas requisicoes concorrentes que passaram da checagem acima ao
 *    mesmo tempo.
 */
export async function processInfinitePayWebhook(
  rawBody: string,
  token: string | null,
): Promise<{ alreadyProcessed: boolean }> {
  let rawPayload: InfinitePayRawPayload;
  try {
    rawPayload = JSON.parse(rawBody);
  } catch {
    throw new Error("Payload do webhook InfinitePay inválido (JSON malformado)");
  }

  // Extraidos so para saber ONDE procurar (idempotencia / sessao) — nenhuma
  // decisao financeira e tomada com base neles antes da validacao abaixo.
  const orderNsu = typeof rawPayload.order_nsu === "string" ? rawPayload.order_nsu : null;
  const transactionNsu = rawPayload.transaction_nsu != null ? String(rawPayload.transaction_nsu) : null;

  if (!transactionNsu) {
    throw new Error("Webhook InfinitePay sem transaction_nsu");
  }

  const payloadHash = sha256Hex(rawBody);

  const [existingEvent] = await db
    .select()
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, "infinitepay"), eq(webhookEvents.externalEventId, transactionNsu)));

  if (existingEvent) {
    return { alreadyProcessed: true };
  }

  let webhookEvent: typeof webhookEvents.$inferSelect;
  try {
    [webhookEvent] = await db
      .insert(webhookEvents)
      .values({
        provider: "infinitepay",
        externalEventId: transactionNsu,
        eventType: "payment.confirmed",
        payloadHash,
        processingStatus: "processing",
      })
      .returning();
  } catch (err) {
    // Corrida: outra requisicao inseriu o mesmo (provider, externalEventId)
    // entre o SELECT acima e este INSERT.
    if (isUniqueViolation(err)) {
      return { alreadyProcessed: true };
    }
    throw err;
  }

  const adapter = getPaymentsAdapter();

  const isValid = await adapter.validateWebhook(rawBody, token);
  if (!isValid) {
    await db
      .update(webhookEvents)
      .set({ processingStatus: "failed", errorMessage: "Token/assinatura do webhook inválido" })
      .where(eq(webhookEvents.id, webhookEvent.id));
    throw new InvalidWebhookSignatureError();
  }

  const parsed = adapter.parseWebhook(rawBody);

  if (!orderNsu) {
    await db
      .update(webhookEvents)
      .set({ processingStatus: "failed", errorMessage: "order_nsu ausente no payload do webhook" })
      .where(eq(webhookEvents.id, webhookEvent.id));
    throw new Error("Webhook InfinitePay sem order_nsu");
  }

  const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, orderNsu));
  if (!session) {
    await db
      .update(webhookEvents)
      .set({ processingStatus: "failed", errorMessage: "Sessão de checkout não encontrada para order_nsu" })
      .where(eq(webhookEvents.id, webhookEvent.id));
    throw new Error("Sessão de checkout não encontrada para order_nsu");
  }

  const items = await db.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, session.id));
  const expectedAmount = items.reduce((sum, item) => sum + item.amount, 0);

  const receivedAmount =
    typeof rawPayload.amount === "number" ? rawPayload.amount : Number(rawPayload.amount);

  if (!Number.isFinite(receivedAmount) || receivedAmount !== expectedAmount) {
    await db
      .update(webhookEvents)
      .set({ processingStatus: "failed", errorMessage: "Valor do webhook diverge do esperado" })
      .where(eq(webhookEvents.id, webhookEvent.id));
    throw new Error("Valor do webhook diverge do esperado");
  }

  const paymentMethod = typeof rawPayload.capture_method === "string" ? rawPayload.capture_method : null;

  let alreadyProcessedByUniqueConstraint = false;

  await db.transaction(async (tx) => {
    let insertedPayment: typeof payments.$inferSelect | undefined;
    try {
      [insertedPayment] = await tx
        .insert(payments)
        .values({
          organizationId: session.organizationId,
          participantId: session.participantId,
          gateway: "infinitepay",
          gatewayPaymentId: parsed.gatewayPaymentId,
          amount: expectedAmount,
          status: "confirmed",
          paidAt: new Date(),
          paymentMethod,
        })
        .returning();
    } catch (err) {
      // payments.gateway_payment_id unique: a mesma transaction_nsu ja foi
      // usada para confirmar um pagamento (corrida entre duas entregas do
      // mesmo webhook que passaram da checagem de webhook_events ao mesmo
      // tempo). Trata como idempotencia, nao como erro fatal.
      if (isUniqueViolation(err)) {
        alreadyProcessedByUniqueConstraint = true;
        return;
      }
      throw err;
    }

    if (!insertedPayment) return;

    await tx.insert(paymentAllocations).values(
      items.map((item) => ({
        paymentId: insertedPayment.id,
        chargeId: item.chargeId,
        amount: item.amount,
      })),
    );

    const chargeIds = items.map((item) => item.chargeId);
    if (chargeIds.length > 0) {
      await tx
        .update(charges)
        .set({ status: "paid" })
        .where(and(inArray(charges.id, chargeIds), eq(charges.status, "checkout_pending")));
    }

    await tx.update(checkoutSessions).set({ status: "completed" }).where(eq(checkoutSessions.id, session.id));

    await tx.insert(auditEvents).values({
      organizationId: session.organizationId,
      entityType: "payment",
      entityId: insertedPayment.id,
      action: "payment_confirmed_via_webhook",
      actorType: "system",
      metadata: {
        webhookEventId: webhookEvent.id,
        gatewayPaymentId: parsed.gatewayPaymentId,
        provider: "infinitepay",
      },
    });
  });

  await db
    .update(webhookEvents)
    .set({ processingStatus: "processed", processedAt: new Date() })
    .where(eq(webhookEvents.id, webhookEvent.id));

  return { alreadyProcessed: alreadyProcessedByUniqueConstraint };
}
