import type {
  PaymentsAdapter,
  CreateCheckoutInput,
  CreateCheckoutResult,
  GatewayPayment,
  GetPaymentInput,
  ParsedWebhookEvent,
} from "./adapter";
import { createHmac } from "node:crypto";

export function calculateAsaasCharge(input: {
  netAmountForOrganizer: number;
  fixedSplitToPartner: number;
  pixFeeCents: number;
}) {
  const netAfterFee = input.netAmountForOrganizer + input.fixedSplitToPartner;
  const grossAmount = netAfterFee + input.pixFeeCents;
  return {
    grossAmount,
    netAfterFee,
    organizerAmount: input.netAmountForOrganizer,
  };
}

function getAsaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY;
  const apiUrl = process.env.ASAAS_API_URL;
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!apiKey || !apiUrl) {
    throw new Error("ASAAS_API_KEY/ASAAS_API_URL ausentes");
  }
  return { apiKey, apiUrl, webhookToken };
}

export function createAsaasAdapter(): PaymentsAdapter {
  const { apiKey, apiUrl, webhookToken } = getAsaasConfig();

  return {
    async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
      const response = await fetch(`${apiUrl}/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          access_token: apiKey,
        },
        body: JSON.stringify({
          customer: input.participantId,
          billingType: "PIX",
          value: input.amount / 100,
          dueDate: input.dueDate,
          externalReference: input.idempotencyKey,
          splits: input.splits.map((s) => ({
            walletId: s.walletId,
            fixedValue: s.fixedValue / 100,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Asaas createCheckout falhou: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      return {
        gatewayCheckoutId: data.id,
        checkoutUrl: data.invoiceUrl,
      };
    },

    async getPayment(input: GetPaymentInput): Promise<GatewayPayment> {
      const gatewayPaymentId = input.gatewayPaymentId;
      const response = await fetch(`${apiUrl}/payments/${gatewayPaymentId}`, {
        headers: { access_token: apiKey },
      });
      if (!response.ok) {
        throw new Error(`Asaas getPayment falhou: ${response.status}`);
      }
      const data = await response.json();

      const statusMap: Record<string, GatewayPayment["status"]> = {
        PENDING: "pending",
        RECEIVED: "confirmed",
        CONFIRMED: "confirmed",
        OVERDUE: "pending",
        REFUNDED: "refunded",
        FAILED: "failed",
      };

      return {
        gatewayPaymentId: data.id,
        status: statusMap[data.status] ?? "pending",
        amount: Math.round(data.value * 100),
        paidAt: data.paymentDate ?? null,
        paymentMethod: data.billingType ?? null,
      };
    },

    async refundPayment(gatewayPaymentId: string): Promise<void> {
      const response = await fetch(`${apiUrl}/payments/${gatewayPaymentId}/refund`, {
        method: "POST",
        headers: { access_token: apiKey },
      });
      if (!response.ok) {
        throw new Error(`Asaas refundPayment falhou: ${response.status}`);
      }
    },

    validateWebhook(rawBody: string, signatureHeader: string | null): boolean {
      if (!webhookToken) return false;
      if (!signatureHeader) return false;
      const expected = createHmac("sha256", webhookToken).update(rawBody).digest("hex");
      return expected === signatureHeader;
    },

    parseWebhook(rawBody: string): ParsedWebhookEvent {
      const data = JSON.parse(rawBody);
      return {
        externalEventId: `${data.event}:${data.payment.id}:${data.payment.status}`,
        eventType: data.event,
        gatewayPaymentId: data.payment.id,
      };
    },
  };
}

// AVISO (mantido do plano de implementação): validateWebhook usa HMAC-SHA256 sobre o corpo
// bruto contra ASAAS_WEBHOOK_TOKEN. Confirmar o mecanismo real de assinatura na documentação
// atual da Asaas antes de ligar em producao — a Asaas pode usar um token estatico no header em
// vez de HMAC; o formato exato deve ser validado na conta real antes do go-live, ja que isso
// nao foi verificado nesta sessao de planejamento.
