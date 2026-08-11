/**
 * Cliente HTTP tipado para as rotas de API reais construidas nas Fases 0-8.
 *
 * Cobre apenas as rotas que ja existem no backend hoje. Nao ha rotas de
 * listagem de charges/participants por grupo — apenas mutacoes (criar grupo,
 * gerar periodo, adicionar/remover participante, baixa manual) e as rotas
 * publicas de checkout. Ver nota em groupay-dashboard.tsx sobre o que ainda
 * nao esta ligado a este cliente.
 */

type ApiErrorBody = { error?: string; issues?: { message: string }[]; message?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  const data = await response.json();

  if (!response.ok) {
    const errorBody = data as ApiErrorBody;
    const message = errorBody.issues?.[0]?.message ?? errorBody.message ?? errorBody.error ?? "Erro desconhecido";
    throw new Error(message);
  }

  return data as T;
}

export type CreateGroupInput = {
  name: string;
  sport?: string;
  billingDay: number;
  defaultAmount: number;
};

export type ManualSettlementInput = {
  paymentMethod: "dinheiro" | "transferencia" | "outro";
  observation?: string;
};

export type CheckoutResult = {
  checkoutSessionId: string;
  checkoutUrl: string;
  totalChargesAmount: number;
};

export const apiClient = {
  /** GET /api/groups — grupos da organizacao autenticada (cookie de sessao). */
  async listGroups() {
    const data = await request<{ groups: unknown[] }>("/api/groups", { method: "GET" });
    return data.groups;
  },

  /** POST /api/groups */
  async createGroup(input: CreateGroupInput) {
    const data = await request<{ group: unknown }>("/api/groups", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return data.group;
  },

  /** POST /api/groups/:groupId/billing-periods */
  async generateBillingPeriod(groupId: string, referenceMonth: string) {
    const data = await request<{ billingPeriod: unknown }>(`/api/groups/${groupId}/billing-periods`, {
      method: "POST",
      body: JSON.stringify({ referenceMonth }),
    });
    return data.billingPeriod;
  },

  /** POST /api/charges/:chargeId/manual-settlement */
  async registerManualSettlement(chargeId: string, input: ManualSettlementInput) {
    await request<{ ok: true }>(`/api/charges/${chargeId}/manual-settlement`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** GET /api/public/groups/:groupPublicSlug/pending-charges?phone=... (rota publica, sem sessao) */
  async listPendingCharges(groupPublicSlug: string, phone: string) {
    const data = await request<{ pending: unknown[] }>(
      `/api/public/groups/${groupPublicSlug}/pending-charges?phone=${encodeURIComponent(phone)}`,
      { method: "GET" },
    );
    return data.pending;
  },

  /**
   * POST /api/public/groups/:groupPublicSlug/checkout (rota publica, sem sessao).
   * O corpo de resposta vem aninhado em `checkout` — diferente do plano
   * original (que assumia Asaas e um retorno plano `{checkoutUrl}`); hoje o
   * gateway e InfinitePay e o servico devolve
   * `{ checkout: { checkoutSessionId, checkoutUrl, totalChargesAmount } }`.
   */
  async createCheckout(groupPublicSlug: string, phone: string, chargeIds: string[], idempotencyKey: string) {
    const data = await request<{ checkout: CheckoutResult }>(`/api/public/groups/${groupPublicSlug}/checkout`, {
      method: "POST",
      body: JSON.stringify({ phone, chargeIds, idempotencyKey }),
    });
    return data.checkout;
  },
};
