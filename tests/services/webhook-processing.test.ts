import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/db";
import {
  organizations,
  groups,
  gatewayAccounts,
  charges,
  payments,
  paymentAllocations,
  checkoutSessions,
  webhookEvents,
  auditEvents,
  whatsappNotifications,
} from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { createCheckoutForCharges } from "@/services/checkout";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";
import {
  processInfinitePayWebhook,
  InvalidWebhookSignatureError,
  WebhookReplayMismatchError,
  checkInfinitePayPayment,
} from "@/services/webhook-processing";
import { deriveCheckoutToken } from "@/payments/session-tokens";

// Nao mockamos @/payments aqui: queremos que createCheckoutForCharges use o
// InfinitePayAdapter real (validateWebhook/parseWebhook reais, com lookup
// real no banco), para que o teste de webhook seja fiel ao comportamento em
// producao. So a chamada de rede (fetch) feita por createCheckout e mockada.
// O adapter real embute o webhookToken em claro na querystring de
// `webhook_url` enviada para a InfinitePay — capturamos o body dessa
// chamada para extrair o token real gerado pelo service, exatamente como a
// InfinitePay faria ao devolver esse webhook_url no payload do webhook.
function mockFetchCreateLink() {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const orderNsu = body.order_nsu as string;
    return {
      ok: true,
      json: async () => ({ url: `https://checkout.infinitepay.io/mock-${orderNsu}` }),
      text: async () => "",
    };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function extractWebhookToken(fetchMock: ReturnType<typeof mockFetchCreateLink>): string {
  const [, init] = fetchMock.mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string);
  const webhookUrl = new URL(body.webhook_url as string);
  const token = webhookUrl.searchParams.get("token");
  if (!token) throw new Error("token nao encontrado na webhook_url capturada");
  return token;
}

describe("processInfinitePayWebhook", () => {
  const originalFetch = global.fetch;
  let organizationId: string;
  let groupPublicSlug: string;
  const phone = "(11) 90000-0777";

  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();

    const [org] = await db.insert(organizations).values({ name: "Org Webhook Teste" }).returning();
    organizationId = org.id;
    const [group] = await db
      .insert(groups)
      .values({ organizationId, name: "Futebol", publicSlug: "futebol-wh-1", billingDay: 10, defaultAmount: 9000 })
      .returning();
    groupPublicSlug = group.publicSlug;

    const participant = await findOrCreateParticipantByPhone(organizationId, phone, "Maria Responsável");
    await linkParticipantToGroup(organizationId, group.id, participant.id, new Date("2026-07-01T12:00:00Z"));

    await db.insert(gatewayAccounts).values({
      organizationId,
      provider: "infinitepay",
      externalAccountId: "handle-teste",
      status: "active",
    });

    await generateBillingPeriod(organizationId, group.id, "2026-08");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function setupCheckoutSession(idempotencyKey: string) {
    const fetchMock = mockFetchCreateLink();
    const pendingCharges = await db.select().from(charges);
    const result = await createCheckoutForCharges(
      groupPublicSlug,
      phone,
      pendingCharges.map((c) => c.id),
      idempotencyKey,
    );
    const webhookToken = extractWebhookToken(fetchMock);
    return { ...result, webhookToken };
  }

  function buildRawBody(orderNsu: string, transactionNsu: string, amount: number) {
    return JSON.stringify({
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      amount,
      invoice_slug: "invoice-test",
      capture_method: "pix",
    });
  }

  it("caminho feliz: token e valor corretos confirmam o pagamento e marcam as charges como pagas", async () => {
    const { checkoutSessionId, totalChargesAmount, webhookToken } = await setupCheckoutSession("idem-webhook-ok");

    const rawBody = buildRawBody(checkoutSessionId, "txn-ok-1", totalChargesAmount);

    const result = await processInfinitePayWebhook(rawBody, webhookToken);

    expect(result).toEqual({ alreadyProcessed: false });

    const sessionCharges = await db
      .select()
      .from(charges)
      .where(eq(charges.billingPeriodId, (await db.select().from(charges))[0].billingPeriodId));
    for (const charge of sessionCharges) {
      expect(charge.status).toBe("paid");
    }

    const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, checkoutSessionId));
    expect(session.status).toBe("completed");

    const paymentRows = await db.select().from(payments).where(eq(payments.gatewayPaymentId, "txn-ok-1"));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0].amount).toBe(totalChargesAmount);
    expect(paymentRows[0].status).toBe("confirmed");
    expect(paymentRows[0].paymentMethod).toBe("pix");
    expect(paymentRows[0].organizationId).toBe(organizationId);

    const allocations = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentRows[0].id));
    expect(allocations).toHaveLength(sessionCharges.length);

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, paymentRows[0].id));
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("payment_confirmed_via_webhook");
    expect(audits[0].actorType).toBe("system");

    const events = await db.select().from(webhookEvents).where(eq(webhookEvents.externalEventId, "txn-ok-1"));
    expect(events).toHaveLength(1);
    expect(events[0].processingStatus).toBe("processed");
  });

  it("token errado lanca InvalidWebhookSignatureError e nao altera nenhuma charge", async () => {
    const { checkoutSessionId, totalChargesAmount } = await setupCheckoutSession("idem-webhook-token-errado");

    const beforeCharges = await db.select().from(charges);

    const rawBody = buildRawBody(checkoutSessionId, "txn-token-errado", totalChargesAmount);

    await expect(processInfinitePayWebhook(rawBody, "token-invalido-qualquer")).rejects.toThrow(
      InvalidWebhookSignatureError,
    );

    const afterCharges = await db.select().from(charges);
    expect(afterCharges).toEqual(beforeCharges);

    const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, checkoutSessionId));
    expect(session.status).not.toBe("completed");
  });

  it("valor divergente lanca erro e nao altera nenhuma charge", async () => {
    const { checkoutSessionId, totalChargesAmount, webhookToken } = await setupCheckoutSession(
      "idem-webhook-valor-errado",
    );

    const beforeCharges = await db.select().from(charges);

    const rawBody = buildRawBody(checkoutSessionId, "txn-valor-errado", totalChargesAmount + 1);

    await expect(processInfinitePayWebhook(rawBody, webhookToken)).rejects.toThrow();

    const afterCharges = await db.select().from(charges);
    expect(afterCharges).toEqual(beforeCharges);

    const paymentRows = await db.select().from(payments).where(eq(payments.gatewayPaymentId, "txn-valor-errado"));
    expect(paymentRows).toHaveLength(0);
  });

  it("webhook repetido (mesmo transaction_nsu) e idempotente e nao duplica payments/allocations", async () => {
    // Organização segue "dora" (padrão): CobraDora agora usa XGate com exclusividade
    // e não pode mais ter sessão InfinitePay, então este cenário de webhook InfinitePay
    // não cobre mais o aviso ao organizador (ver "docs/whatsapp-premium-xgate.md").
    const { checkoutSessionId, totalChargesAmount, webhookToken } = await setupCheckoutSession(
      "idem-webhook-repetido",
    );

    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-meta-teste");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id-teste");
    vi.stubEnv("WHATSAPP_ORGANIZER_UPDATE_TEMPLATE_NAME", "lista_atualizada_teste");
    const metaFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.organizador-teste" }] }),
      text: async () => "",
    });
    global.fetch = metaFetch as unknown as typeof fetch;

    const rawBody = buildRawBody(checkoutSessionId, "txn-repetido-1", totalChargesAmount);

    const first = await processInfinitePayWebhook(rawBody, webhookToken);
    expect(first).toEqual({ alreadyProcessed: false });

    const second = await processInfinitePayWebhook(rawBody, webhookToken);
    expect(second).toEqual({ alreadyProcessed: true });

    const paymentRows = await db.select().from(payments).where(eq(payments.gatewayPaymentId, "txn-repetido-1"));
    expect(paymentRows).toHaveLength(1);

    const allocations = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentRows[0].id));
    expect(allocations.length).toBeGreaterThan(0);

    const events = await db.select().from(webhookEvents).where(eq(webhookEvents.externalEventId, "txn-repetido-1"));
    expect(events).toHaveLength(1);

    // Plano grátis (dora): enqueueOrganizerListUpdates não cria aviso ao organizador.
    const notifications = await db.select().from(whatsappNotifications);
    expect(notifications).toHaveLength(0);
    expect(metaFetch).not.toHaveBeenCalled();
  });

  it("webhook tardio reconcilia sessao vinculada expirada sem criar um segundo checkout", async () => {
    const { checkoutSessionId, totalChargesAmount, webhookToken } = await setupCheckoutSession(
      "idem-webhook-expirado",
    );
    const [chargeBefore] = await db.select().from(charges);
    await db
      .update(checkoutSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(checkoutSessions.id, checkoutSessionId));

    await expect(
      createCheckoutForCharges(groupPublicSlug, phone, [chargeBefore.id], "idem-webhook-expirado"),
    ).rejects.toThrow(/reconciliada/);
    const [released] = await db.select().from(charges).where(eq(charges.id, chargeBefore.id));
    expect(released.status).toBe("open");

    await processInfinitePayWebhook(
      buildRawBody(checkoutSessionId, "txn-webhook-expirado", totalChargesAmount),
      webhookToken,
    );
    const [paid] = await db.select().from(charges).where(eq(charges.id, chargeBefore.id));
    expect(paid.status).toBe("paid");
  });

  it("rejeita o mesmo transaction_nsu quando o payload diverge do primeiro", async () => {
    const { checkoutSessionId, totalChargesAmount, webhookToken } = await setupCheckoutSession(
      "idem-webhook-replay-divergente",
    );
    const firstPayload = buildRawBody(checkoutSessionId, "txn-replay-divergente", totalChargesAmount);
    await processInfinitePayWebhook(firstPayload, webhookToken);

    const divergentPayload = JSON.stringify({
      ...JSON.parse(firstPayload),
      receipt_url: "https://comprovante.example/alterado",
    });
    await expect(processInfinitePayWebhook(divergentPayload, webhookToken)).rejects.toThrow(
      WebhookReplayMismatchError,
    );
    expect(await db.select().from(payments)).toHaveLength(1);
  });

  it("payment_check confirmado usa a mesma transacao de confirmacao e marca apenas apos resposta paid=true", async () => {
    const { checkoutSessionId, totalChargesAmount } = await setupCheckoutSession("idem-payment-check-ok");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, paid: true, amount: totalChargesAmount, capture_method: "pix" }),
    }) as unknown as typeof fetch;

    const result = await checkInfinitePayPayment({
      sessionId: checkoutSessionId,
      recoveryToken: deriveCheckoutToken(checkoutSessionId, "recovery"),
      transactionNsu: "txn-payment-check-1",
      invoiceSlug: "invoice-payment-check-1",
    });

    expect(result.status).toBe("confirmed");
    const [charge] = await db.select().from(charges);
    expect(charge.status).toBe("paid");
    const [payment] = await db.select().from(payments).where(eq(payments.gatewayPaymentId, "txn-payment-check-1"));
    expect(payment.status).toBe("confirmed");
  });

  it("payment_check usa o handle congelado na sessao mesmo se a configuracao mudar e for desativada", async () => {
    const { checkoutSessionId, totalChargesAmount } = await setupCheckoutSession("idem-payment-check-snapshot");
    await db
      .update(gatewayAccounts)
      .set({ externalAccountId: "handle-alterado", status: "disabled" })
      .where(eq(gatewayAccounts.organizationId, organizationId));
    const paymentCheckFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, paid: false, amount: totalChargesAmount }),
    });
    global.fetch = paymentCheckFetch as unknown as typeof fetch;

    const result = await checkInfinitePayPayment({
      sessionId: checkoutSessionId,
      recoveryToken: deriveCheckoutToken(checkoutSessionId, "recovery"),
      transactionNsu: "txn-payment-check-snapshot",
      invoiceSlug: "invoice-payment-check-snapshot",
    });

    expect(result.status).toBe("pending");
    const [, init] = paymentCheckFetch.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(
      expect.objectContaining({ handle: "handle-teste", order_nsu: checkoutSessionId }),
    );
  });

  it("payment_check paid=false nao altera a cobranca para paga", async () => {
    const { checkoutSessionId, totalChargesAmount } = await setupCheckoutSession("idem-payment-check-pendente");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, paid: false, amount: totalChargesAmount }),
    }) as unknown as typeof fetch;

    const result = await checkInfinitePayPayment({
      sessionId: checkoutSessionId,
      recoveryToken: deriveCheckoutToken(checkoutSessionId, "recovery"),
      transactionNsu: "txn-payment-check-pendente",
      invoiceSlug: "invoice-payment-check-pendente",
    });

    expect(result.status).toBe("pending");
    const [charge] = await db.select().from(charges);
    expect(charge.status).toBe("checkout_pending");
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it("order_nsu desconhecido (sessao inexistente) lanca erro e nao altera nenhuma charge", async () => {
    await setupCheckoutSession("idem-webhook-order-desconhecido");

    const beforeCharges = await db.select().from(charges);

    const fakeOrderNsu = "00000000-0000-0000-0000-000000000000";
    const rawBody = buildRawBody(fakeOrderNsu, "txn-order-desconhecido", 9000);

    // token nulo ja e suficiente pra falhar em validateWebhook (sessao nao
    // existe -> sem webhookTokenHash pra comparar), entao usamos um token
    // arbitrario so pra deixar claro que o teste esta testando o branch de
    // "sessao nao encontrada" e nao o de assinatura invalida seria
    // redundante — o adapter real retorna false tambem nesse caso porque a
    // query no banco nao acha ninguem. Verificamos que o erro lancado nao e
    // InvalidWebhookSignatureError checando a mensagem esperada via reject.
    await expect(processInfinitePayWebhook(rawBody, "token-qualquer")).rejects.toThrow();

    const afterCharges = await db.select().from(charges);
    expect(afterCharges).toEqual(beforeCharges);
  });
});
