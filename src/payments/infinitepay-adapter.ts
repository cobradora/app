import type {
  PaymentsAdapter,
  CreateCheckoutInput,
  CreateCheckoutResult,
  GatewayPayment,
  ParsedWebhookEvent,
} from "./adapter";
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { checkoutSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

// Mesmos dominios oficiais validados pelo portal-de-torcida
// (netlify/functions/lib/infinitepay.mjs) — protege contra a InfinitePay (ou
// um MITM) devolver uma URL de checkout fora do dominio esperado.
const ALLOWED_CHECKOUT_HOSTS = new Set(["checkout.infinitepay.com.br", "checkout.infinitepay.io"]);

const DEFAULT_INFINITEPAY_API_URL = "https://api.checkout.infinitepay.io";

export function getInfinitePayConfig() {
  const apiUrl = process.env.INFINITEPAY_API_URL ?? DEFAULT_INFINITEPAY_API_URL;
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new Error("APP_BASE_URL ausente");
  }
  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    appBaseUrl: appBaseUrl.replace(/\/$/, ""),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateCheckoutUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("InfinitePay retornou uma URL de checkout malformada.");
  }
  if (url.protocol !== "https:" || !ALLOWED_CHECKOUT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`InfinitePay retornou um domínio de checkout inesperado: ${url.hostname}`);
  }
  return url.href;
}

export function createInfinitePayAdapter(): PaymentsAdapter {
  return {
    async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
      const { apiUrl, appBaseUrl } = getInfinitePayConfig();

      // No fluxo real (src/services/checkout.ts) a checkoutSession do Groupay
      // ja foi salva no banco ANTES desta chamada e seu id chega aqui via
      // `externalReference` (mesmo padrao do portal-de-torcida: o pedido
      // existe antes de qualquer chamada a InfinitePay). O fallback para
      // randomUUID() so existe para permitir chamar o adapter isoladamente
      // (ex.: testes) sem depender do service.
      const orderNsu = input.externalReference ?? randomUUID();
      const webhookToken = input.webhookToken ?? randomBytes(32).toString("base64url");

      const response = await fetch(`${apiUrl}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: input.gatewayExternalAccountId,
          order_nsu: orderNsu,
          items: [{ quantity: 1, price: input.amount, description: "Cobrança Groupay" }],
          redirect_url: `${appBaseUrl}/pagamento/sucesso`,
          webhook_url: `${appBaseUrl}/api/webhooks/infinitepay?token=${encodeURIComponent(webhookToken)}`,
          ...(input.buyerPhone && {
            customer: { name: input.buyerName, phone_number: input.buyerPhone },
          }),
        }),
      });

      if (!response.ok) {
        throw new Error(`InfinitePay createCheckout falhou: ${response.status} ${await response.text()}`);
      }

      const payload = await response.json().catch(() => null);
      if (!payload?.url) {
        throw new Error("InfinitePay não retornou a URL do checkout.");
      }

      const checkoutUrl = validateCheckoutUrl(payload.url);

      return {
        gatewayCheckoutId: orderNsu,
        checkoutUrl,
      };
    },

    async getPayment(gatewayPaymentId: string): Promise<GatewayPayment> {
      const { apiUrl } = getInfinitePayConfig();
      const response = await fetch(`${apiUrl}/payment_check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_nsu: gatewayPaymentId }),
      });

      if (!response.ok) {
        throw new Error(`InfinitePay getPayment falhou: ${response.status}`);
      }

      const data = await response.json().catch(() => ({}) as Record<string, unknown>);

      const statusMap: Record<string, GatewayPayment["status"]> = {
        paid: "confirmed",
        approved: "confirmed",
        pending: "pending",
        refunded: "refunded",
        failed: "failed",
      };
      const rawStatus = String((data as Record<string, unknown>).status ?? "").toLowerCase();

      return {
        gatewayPaymentId: String((data as Record<string, unknown>).transaction_nsu ?? gatewayPaymentId),
        status: statusMap[rawStatus] ?? "pending",
        amount: typeof (data as Record<string, unknown>).amount === "number" ? ((data as Record<string, unknown>).amount as number) : 0,
        paidAt: ((data as Record<string, unknown>).paid_at as string | undefined) ?? null,
        paymentMethod: ((data as Record<string, unknown>).capture_method as string | undefined) ?? null,
      };
    },

    async refundPayment(): Promise<void> {
      throw new Error(
        "refundPayment não implementado para InfinitePay — endpoint de estorno não confirmado contra a documentação oficial; verificar antes de usar em produção",
      );
    },

    async validateWebhook(rawBody: string, token: string | null): Promise<boolean> {
      if (!token) return false;

      let payload: { order_nsu?: unknown };
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return false;
      }

      const orderNsu = payload?.order_nsu;
      if (typeof orderNsu !== "string" || orderNsu.length === 0) return false;

      const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, orderNsu));
      if (!session?.webhookTokenHash) return false;

      const expected = Buffer.from(session.webhookTokenHash, "hex");
      const received = Buffer.from(sha256(token), "hex");
      if (expected.length !== received.length) return false;

      return timingSafeEqual(expected, received);
    },

    parseWebhook(rawBody: string): ParsedWebhookEvent {
      const payload = JSON.parse(rawBody);
      return {
        externalEventId: String(payload.transaction_nsu),
        eventType: "payment.confirmed",
        gatewayPaymentId: String(payload.transaction_nsu),
      };
    },
  };
}
