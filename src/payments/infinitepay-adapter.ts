import type {
  PaymentsAdapter,
  CreateCheckoutInput,
  CreateCheckoutResult,
  GatewayPayment,
  GetPaymentInput,
  ParsedWebhookEvent,
} from "./adapter";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@/db";
import { checkoutSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { matchesCheckoutToken } from "./session-tokens";

const ALLOWED_CHECKOUT_HOSTS = new Set(["checkout.infinitepay.com.br", "checkout.infinitepay.io"]);
const DEFAULT_INFINITEPAY_API_URL = "https://api.checkout.infinitepay.io";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Distingue rejeição definitiva do provedor de uma falha ambígua. Em uma
 * falha ambígua, liberar as cobranças seria perigoso: a InfinitePay pode ter
 * criado um link mesmo que nossa função não tenha recebido a resposta.
 */
export class InfinitePayCheckoutRequestError extends Error {
  constructor(
    message: string,
    readonly mayHaveSucceeded: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "InfinitePayCheckoutRequestError";
  }
}

function parseConfiguredUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} inválida`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} não pode conter credenciais, query string ou fragmento`);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`${label} deve usar HTTPS em produção`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} deve usar HTTP ou HTTPS`);
  }
  return url;
}

export function getInfinitePayConfig() {
  const apiUrl = parseConfiguredUrl(
    process.env.INFINITEPAY_API_URL ?? DEFAULT_INFINITEPAY_API_URL,
    "INFINITEPAY_API_URL",
  );
  const appBaseUrlRaw = process.env.APP_BASE_URL;
  if (!appBaseUrlRaw) throw new Error("APP_BASE_URL ausente");
  const appBaseUrl = parseConfiguredUrl(appBaseUrlRaw, "APP_BASE_URL");

  return {
    apiUrl: apiUrl.href.replace(/\/$/, ""),
    appBaseUrl: appBaseUrl.href.replace(/\/$/, ""),
  };
}

function validateCheckoutUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InfinitePayCheckoutRequestError("InfinitePay retornou uma URL de checkout malformada", true);
  }
  if (url.protocol !== "https:" || !ALLOWED_CHECKOUT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new InfinitePayCheckoutRequestError(
      `InfinitePay retornou um domínio de checkout inesperado: ${url.hostname}`,
      true,
    );
  }
  return url.href;
}

function callbackUrl(appBaseUrl: string, pathname: string): URL {
  return new URL(pathname, `${appBaseUrl}/`);
}

function isDefinitiveRejection(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

export function createInfinitePayAdapter(): PaymentsAdapter {
  return {
    async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
      let apiUrl: string;
      let appBaseUrl: string;
      try {
        ({ apiUrl, appBaseUrl } = getInfinitePayConfig());
      } catch (error) {
        throw new InfinitePayCheckoutRequestError((error as Error).message, false);
      }
      const orderNsu = input.externalReference ?? randomUUID();
      const webhookToken = input.webhookToken ?? randomBytes(32).toString("base64url");

      const redirectUrl = callbackUrl(appBaseUrl, "/pagamento/sucesso");
      redirectUrl.searchParams.set("order_nsu", orderNsu);
      if (input.recoveryToken) redirectUrl.searchParams.set("recovery_token", input.recoveryToken);

      const webhookUrl = callbackUrl(appBaseUrl, "/api/webhooks/infinitepay");
      webhookUrl.searchParams.set("token", webhookToken);

      let response: Response;
      try {
        response = await fetch(`${apiUrl}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            handle: input.gatewayExternalAccountId,
            order_nsu: orderNsu,
            items: [{ quantity: 1, price: input.amount, description: "Cobrança CobraDora" }],
            redirect_url: redirectUrl.href,
            webhook_url: webhookUrl.href,
            ...(input.buyerPhone && input.buyerName?.trim() && {
              customer: { name: input.buyerName.trim(), phone_number: input.buyerPhone },
            }),
          }),
        });
      } catch (error) {
        throw new InfinitePayCheckoutRequestError(
          `Não foi possível concluir a chamada de criação do checkout: ${(error as Error).message}`,
          true,
        );
      }

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new InfinitePayCheckoutRequestError(
          `InfinitePay recusou a criação do checkout (${response.status})${detail ? `: ${detail}` : ""}`,
          !isDefinitiveRejection(response.status),
          response.status,
        );
      }

      const payload = await response.json().catch(() => null);
      if (!payload?.url || typeof payload.url !== "string") {
        throw new InfinitePayCheckoutRequestError("InfinitePay não retornou a URL do checkout", true);
      }

      return {
        gatewayCheckoutId: orderNsu,
        checkoutUrl: validateCheckoutUrl(payload.url),
      };
    },

    async getPayment(input: GetPaymentInput): Promise<GatewayPayment> {
      const { apiUrl } = getInfinitePayConfig();
      if (!input.gatewayExternalAccountId || !input.externalReference || !input.invoiceSlug) {
        throw new Error("payment_check exige handle, order_nsu, transaction_nsu e slug");
      }

      const response = await fetch(`${apiUrl}/payment_check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          handle: input.gatewayExternalAccountId,
          order_nsu: input.externalReference,
          transaction_nsu: input.gatewayPaymentId,
          slug: input.invoiceSlug,
        }),
      });

      if (!response.ok) {
        throw new Error(`InfinitePay payment_check falhou (${response.status})`);
      }

      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!data || typeof data !== "object") throw new Error("InfinitePay retornou payment_check inválido");

      const amount = typeof data.amount === "number" ? data.amount : Number(data.amount);
      return {
        gatewayPaymentId: input.gatewayPaymentId,
        status: data.success === true && data.paid === true ? "confirmed" : "pending",
        amount: Number.isFinite(amount) ? amount : 0,
        paidAt: null,
        paymentMethod: typeof data.capture_method === "string" ? data.capture_method : null,
      };
    },

    async refundPayment(): Promise<void> {
      throw new Error(
        "refundPayment não implementado para InfinitePay — confirmar o endpoint oficial antes de usar em produção",
      );
    },

    async validateWebhook(rawBody: string, token: string | null): Promise<boolean> {
      let payload: { order_nsu?: unknown };
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return false;
      }

      const orderNsu = payload.order_nsu;
      if (typeof orderNsu !== "string" || orderNsu.length === 0) return false;

      const [session] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, orderNsu));
      return Boolean(session && session.gateway === "infinitepay" && matchesCheckoutToken(token, session.webhookTokenHash));
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
