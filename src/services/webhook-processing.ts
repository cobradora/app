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
  gatewayAccounts,
} from "@/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getPaymentsAdapter } from "@/payments";
import { matchesCheckoutToken } from "@/payments/session-tokens";
import { z } from "zod";
import {
  dispatchWhatsappNotifications,
  enqueueOrganizerListUpdates,
} from "@/services/whatsapp-notifications";

export class InvalidWebhookSignatureError extends Error {
  constructor(message = "Token do webhook InfinitePay inválido") {
    super(message);
    this.name = "InvalidWebhookSignatureError";
  }
}

export class WebhookReplayMismatchError extends Error {
  constructor(message = "Replay de webhook com conteúdo divergente") {
    super(message);
    this.name = "WebhookReplayMismatchError";
  }
}

export class InvalidRecoveryTokenError extends Error {
  constructor(message = "Token de recuperação inválido") {
    super(message);
    this.name = "InvalidRecoveryTokenError";
  }
}

export class PaymentConfirmationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentConfirmationError";
  }
}

const webhookPayloadSchema = z
  .object({
    order_nsu: z.string().uuid(),
    transaction_nsu: z.union([z.string().min(1).max(200), z.number().finite()]).transform(String),
    invoice_slug: z.string().min(1).max(200).optional(),
    amount: z.union([z.number(), z.string()]).transform((value, context) => {
      const amount = typeof value === "number" ? value : Number(value);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        context.addIssue({ code: "custom", message: "amount inválido" });
        return z.NEVER;
      }
      return amount;
    }),
    capture_method: z.string().min(1).max(40).optional(),
  })
  .passthrough();

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type ConfirmationSource = "webhook" | "payment_check";

type ConfirmPaymentInput = {
  sessionId: string;
  gatewayPaymentId: string;
  gatewayInvoiceSlug: string | null;
  amount: number;
  paymentMethod: string | null;
  source: ConfirmationSource;
  webhookEventId?: string;
};

/**
 * Único ponto que pode transformar cobranças reservadas em pagas. Webhook e
 * payment_check convergem aqui, sob lock da sessão e na mesma transação que
 * cria payment/alocações, conclui a sessão e finaliza o evento de webhook.
 */
export async function confirmInfinitePayPayment(
  input: ConfirmPaymentInput,
): Promise<{ alreadyProcessed: boolean; paymentId: string; notificationIds: string[] }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from checkout_sessions where id = ${input.sessionId} for update`);
    const [session] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, input.sessionId));
    if (!session || session.gateway !== "infinitepay") {
      throw new PaymentConfirmationError("session_not_found", "Sessão de checkout não encontrada");
    }

    if (session.gatewayPaymentId && session.gatewayPaymentId !== input.gatewayPaymentId) {
      throw new PaymentConfirmationError("payment_mismatch", "A sessão já está vinculada a outra transação");
    }
    if (session.gatewayInvoiceSlug && input.gatewayInvoiceSlug && session.gatewayInvoiceSlug !== input.gatewayInvoiceSlug) {
      throw new PaymentConfirmationError("invoice_mismatch", "A sessão já está vinculada a outra fatura");
    }

    if (session.status === "completed") {
      const [existingPayment] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.gatewayPaymentId, input.gatewayPaymentId));
      if (!existingPayment) {
        throw new PaymentConfirmationError("completed_without_payment", "Sessão concluída sem pagamento correspondente");
      }
      if (input.webhookEventId) {
        await tx
          .update(webhookEvents)
          .set({ processingStatus: "processed", processedAt: new Date(), errorMessage: null })
          .where(eq(webhookEvents.id, input.webhookEventId));
      }
      return { alreadyProcessed: true, paymentId: existingPayment.id, notificationIds: [] };
    }

    const expiredButReconcilable =
      session.status === "expired" &&
      (session.externalCreationState === "linked" || session.externalCreationState === "ambiguous");
    if (session.status !== "created" && session.status !== "pending" && !expiredButReconcilable) {
      throw new PaymentConfirmationError("session_not_payable", "Sessão não está disponível para confirmação");
    }

    const items = await tx.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, session.id));
    if (items.length === 0) throw new PaymentConfirmationError("empty_checkout", "Checkout sem cobranças");

    const expectedAmount = items.reduce((sum, item) => sum + item.amount, 0);
    if (input.amount !== expectedAmount) {
      throw new PaymentConfirmationError("amount_mismatch", "Valor confirmado diverge do checkout");
    }

    const itemChargeIds = items.map((item) => item.chargeId);
    const currentCharges = await tx
      .select({ id: charges.id, status: charges.status, billingPeriodId: charges.billingPeriodId })
      .from(charges)
      .where(inArray(charges.id, itemChargeIds));
    const acceptableChargeStatuses = expiredButReconcilable
      ? new Set(["open", "checkout_pending"])
      : new Set(["checkout_pending"]);
    if (
      currentCharges.length !== items.length ||
      currentCharges.some((charge) => !acceptableChargeStatuses.has(charge.status))
    ) {
      throw new PaymentConfirmationError(
        "charge_state_mismatch",
        "Uma ou mais cobranças não pertencem mais a este checkout",
      );
    }

    const [otherSession] = await tx
      .select({ id: checkoutSessions.id })
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.gatewayPaymentId, input.gatewayPaymentId),
          ne(checkoutSessions.id, session.id),
        ),
      );
    if (otherSession) {
      throw new PaymentConfirmationError("payment_reused", "Transação já vinculada a outro checkout");
    }

    const insertedCharges = await tx
      .update(charges)
      .set({ status: "paid", updatedAt: new Date() })
      .where(
        and(
          inArray(charges.id, itemChargeIds),
          inArray(charges.status, expiredButReconcilable ? ["open", "checkout_pending"] : ["checkout_pending"]),
        ),
      )
      .returning({ id: charges.id });
    if (insertedCharges.length !== items.length) {
      throw new PaymentConfirmationError("charge_race", "As cobranças mudaram durante a confirmação");
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        organizationId: session.organizationId,
        participantId: session.participantId,
        gateway: "infinitepay",
        gatewayPaymentId: input.gatewayPaymentId,
        amount: expectedAmount,
        status: "confirmed",
        paidAt: new Date(),
        paymentMethod: input.paymentMethod,
      })
      .onConflictDoNothing({ target: payments.gatewayPaymentId })
      .returning();
    if (!payment) {
      throw new PaymentConfirmationError("payment_reused", "Transação InfinitePay já processada");
    }

    await tx.insert(paymentAllocations).values(
      items.map((item) => ({
        paymentId: payment.id,
        chargeId: item.chargeId,
        amount: item.amount,
      })),
    );

    await tx
      .update(checkoutSessions)
      .set({
        status: "completed",
        gatewayPaymentId: input.gatewayPaymentId,
        gatewayInvoiceSlug: input.gatewayInvoiceSlug ?? session.gatewayInvoiceSlug,
        externalCreationState: "linked",
      })
      .where(eq(checkoutSessions.id, session.id));

    await tx.insert(auditEvents).values({
      organizationId: session.organizationId,
      entityType: "payment",
      entityId: payment.id,
      action: input.source === "webhook" ? "payment_confirmed_via_webhook" : "payment_confirmed_via_payment_check",
      actorType: "system",
      metadata: {
        checkoutSessionId: session.id,
        webhookEventId: input.webhookEventId ?? null,
        gatewayPaymentId: input.gatewayPaymentId,
        gatewayInvoiceSlug: input.gatewayInvoiceSlug,
        provider: "infinitepay",
      },
    });

    if (input.webhookEventId) {
      await tx
        .update(webhookEvents)
        .set({ processingStatus: "processed", processedAt: new Date(), errorMessage: null })
        .where(eq(webhookEvents.id, input.webhookEventId));
    }

    const notificationIds = await enqueueOrganizerListUpdates(tx, {
      organizationId: session.organizationId,
      paymentId: payment.id,
      billingPeriodIds: currentCharges.map((charge) => charge.billingPeriodId),
    });

    return { alreadyProcessed: false, paymentId: payment.id, notificationIds };
  });
}

async function prepareWebhookEvent(transactionNsu: string, payloadHash: string) {
  const [existing] = await db
    .select()
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, "infinitepay"), eq(webhookEvents.externalEventId, transactionNsu)));

  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new WebhookReplayMismatchError();
    if (existing.processingStatus === "processed") return { event: existing, alreadyProcessed: true };

    const [retrying] = await db
      .update(webhookEvents)
      .set({ processingStatus: "processing", errorMessage: null })
      .where(eq(webhookEvents.id, existing.id))
      .returning();
    return { event: retrying, alreadyProcessed: false };
  }

  const [inserted] = await db
    .insert(webhookEvents)
    .values({
      provider: "infinitepay",
      externalEventId: transactionNsu,
      eventType: "payment.confirmed",
      payloadHash,
      processingStatus: "processing",
    })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.externalEventId] })
    .returning();
  if (inserted) return { event: inserted, alreadyProcessed: false };

  // Outra entrega validada venceu a corrida do INSERT. Releia e aplique as
  // mesmas regras de hash/estado; a confirmação central é serializada pela
  // sessão, então duas entregas podem avançar sem duplicar efeitos.
  return prepareWebhookEvent(transactionNsu, payloadHash);
}

export async function processInfinitePayWebhook(
  rawBody: string,
  token: string | null,
): Promise<{ alreadyProcessed: boolean }> {
  const parsedPayload = webhookPayloadSchema.safeParse(JSON.parse(rawBody));
  if (!parsedPayload.success) throw new Error("Payload do webhook InfinitePay inválido");
  const payload = parsedPayload.data;

  const adapter = getPaymentsAdapter("infinitepay");
  if (!(await adapter.validateWebhook(rawBody, token))) throw new InvalidWebhookSignatureError();

  // A sessão e o token são verificados antes de o external_event_id ocupar a
  // chave de idempotência. Isso impede que uma requisição não autenticada
  // envenene o transaction_nsu de uma entrega legítima futura.
  const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, payload.order_nsu));
  if (!session || session.gateway !== "infinitepay") throw new InvalidWebhookSignatureError();
  if (session.status === "completed" && session.gatewayPaymentId !== payload.transaction_nsu) {
    throw new WebhookReplayMismatchError("Sessão concluída recebeu outra transação");
  }
  if (
    session.status === "canceled" ||
    (session.status === "expired" && !["linked", "ambiguous"].includes(session.externalCreationState))
  ) {
    throw new PaymentConfirmationError("session_not_payable", "Sessão cancelada ou expirada");
  }

  const payloadHash = sha256Hex(rawBody);
  const { event, alreadyProcessed } = await prepareWebhookEvent(payload.transaction_nsu, payloadHash);
  if (alreadyProcessed) return { alreadyProcessed: true };

  try {
    const result = await confirmInfinitePayPayment({
      sessionId: session.id,
      gatewayPaymentId: payload.transaction_nsu,
      gatewayInvoiceSlug: payload.invoice_slug ?? null,
      amount: payload.amount,
      paymentMethod: payload.capture_method ?? null,
      source: "webhook",
      webhookEventId: event.id,
    });
    await dispatchWhatsappNotifications(result.notificationIds).catch((dispatchError) => {
      console.error("CobraDora: pagamento confirmado, mas despacho ao organizador falhou", {
        paymentId: result.paymentId,
        errorName: dispatchError instanceof Error ? dispatchError.name : "UnknownError",
      });
    });
    return { alreadyProcessed: result.alreadyProcessed };
  } catch (error) {
    await db
      .update(webhookEvents)
      .set({
        processingStatus: "failed",
        errorMessage: error instanceof PaymentConfirmationError ? error.code : "confirmation_failed",
      })
      .where(eq(webhookEvents.id, event.id));
    throw error;
  }
}

export async function checkInfinitePayPayment(input: {
  sessionId: string;
  recoveryToken: string;
  transactionNsu: string;
  invoiceSlug: string;
}): Promise<{ status: "pending" | "confirmed"; alreadyProcessed: boolean }> {
  const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, input.sessionId));
  if (!session || session.gateway !== "infinitepay" || !matchesCheckoutToken(input.recoveryToken, session.recoveryTokenHash)) {
    throw new InvalidRecoveryTokenError();
  }
  if (session.gatewayPaymentId && session.gatewayPaymentId !== input.transactionNsu) {
    throw new PaymentConfirmationError("payment_mismatch", "A sessão já está vinculada a outra transação");
  }
  if (session.gatewayInvoiceSlug && session.gatewayInvoiceSlug !== input.invoiceSlug) {
    throw new PaymentConfirmationError("invoice_mismatch", "A sessão já está vinculada a outra fatura");
  }
  if (session.status === "completed") return { status: "confirmed", alreadyProcessed: true };
  if (
    session.status === "canceled" ||
    (session.status === "expired" && !["linked", "ambiguous"].includes(session.externalCreationState))
  ) {
    throw new PaymentConfirmationError("session_not_payable", "Sessão cancelada ou expirada");
  }

  let gatewayHandle = session.gatewayExternalAccountIdSnapshot;
  if (!gatewayHandle && session.gatewayAccountId) {
    const [snapshottedAccount] = await db
      .select({ externalAccountId: gatewayAccounts.externalAccountId })
      .from(gatewayAccounts)
      .where(
        and(
          eq(gatewayAccounts.id, session.gatewayAccountId),
          eq(gatewayAccounts.organizationId, session.organizationId),
          eq(gatewayAccounts.provider, "infinitepay"),
        ),
      );
    gatewayHandle = snapshottedAccount?.externalAccountId ?? null;
  }
  // Fallback estritamente legado. Novas sessões sempre persistem o snapshot;
  // o status atual da configuração deliberadamente não interfere na
  // reconciliação de um checkout já criado.
  if (!gatewayHandle) {
    const [legacyAccount] = await db
      .select({ externalAccountId: gatewayAccounts.externalAccountId })
      .from(gatewayAccounts)
      .where(
        and(
          eq(gatewayAccounts.organizationId, session.organizationId),
          eq(gatewayAccounts.provider, "infinitepay"),
        ),
      );
    gatewayHandle = legacyAccount?.externalAccountId ?? null;
  }
  if (!gatewayHandle) throw new PaymentConfirmationError("gateway_snapshot_missing", "Snapshot da InfinitePay ausente");

  const checked = await getPaymentsAdapter("infinitepay").getPayment({
    gatewayPaymentId: input.transactionNsu,
    gatewayExternalAccountId: gatewayHandle,
    externalReference: session.id,
    invoiceSlug: input.invoiceSlug,
  });
  if (checked.status !== "confirmed") return { status: "pending", alreadyProcessed: false };

  const confirmed = await confirmInfinitePayPayment({
    sessionId: session.id,
    gatewayPaymentId: input.transactionNsu,
    gatewayInvoiceSlug: input.invoiceSlug,
    amount: checked.amount,
    paymentMethod: checked.paymentMethod,
    source: "payment_check",
  });
  await dispatchWhatsappNotifications(confirmed.notificationIds).catch((dispatchError) => {
    console.error("CobraDora: pagamento confirmado, mas despacho ao organizador falhou", {
      paymentId: confirmed.paymentId,
      errorName: dispatchError instanceof Error ? dispatchError.name : "UnknownError",
    });
  });
  return { status: "confirmed", alreadyProcessed: confirmed.alreadyProcessed };
}
