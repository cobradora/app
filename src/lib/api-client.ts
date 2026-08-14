/**
 * Cliente HTTP tipado para as rotas de API reais construidas nas Fases 0-8.
 */

type ApiErrorBody = { error?: string; issues?: { message: string }[]; message?: string };

/**
 * Le o corpo da resposta com seguranca: um 500 sem corpo (comum quando o
 * servidor cai antes de montar um JSON de erro, ex. falha de conexao com o
 * banco) nao pode virar um SyntaxError cru de `response.json()` no chamador.
 */
async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    throw new Error(`Resposta vazia do servidor (${response.status} ${response.statusText})`.trim());
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Resposta invalida do servidor (${response.status}): ${text.slice(0, 200)}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  const data = await parseResponseBody(response);

  if (!response.ok) {
    const errorBody = data as ApiErrorBody;
    const message = errorBody.issues?.[0]?.message ?? errorBody.message ?? errorBody.error ?? "Erro desconhecido";
    throw new Error(message);
  }

  return data as T;
}

export type LoginInput = {
  email: string;
  password: string;
};

export type SignupInput = {
  organizationName: string;
  name: string;
  email: string;
  password: string;
};

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

export type AddParticipantInput = {
  name: string;
  phone: string;
};

export type UpdateGroupInput = {
  name: string;
};

export type UpdateParticipantInput = {
  name: string;
  phone: string;
};

export type CheckoutResult = {
  checkoutSessionId: string;
  checkoutUrl: string;
  totalChargesAmount: number;
};

export type PendingCharge = {
  chargeId: string;
  totalAmount: number;
  dueDate: string;
  referenceMonth: string;
};

export type PublicGroupSummary = {
  name: string;
  status: "active" | "archived";
};

export type GroupCharge = {
  chargeId: string;
  participantId: string;
  participantName: string;
  totalAmount: number;
  status: "open" | "checkout_pending" | "paid" | "manually_paid" | "canceled" | "refunded";
  referenceMonth: string;
  dueDate: string;
};

export type OrgCharge = GroupCharge & {
  groupId: string;
  groupName: string;
};

export type GroupParticipant = {
  participantId: string;
  name: string;
  phoneDisplay: string;
};

export type GatewayAccount = {
  id: string;
  organizationId: string;
  provider: string;
  externalAccountId: string;
  status: "pending" | "active" | "disabled";
};

export const apiClient = {
  /** POST /api/auth/login — em sucesso, o cookie de sessao ja vem setado na resposta. */
  async login(input: LoginInput) {
    const data = await request<{ user: { id: string; name: string; email: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return data.user;
  },

  /** POST /api/auth/signup — cria organizacao + usuario owner; cookie de sessao ja vem setado na resposta. */
  async signup(input: SignupInput) {
    const data = await request<{ user: { id: string; name: string; email: string } }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return data.user;
  },

  /** GET /api/settings/gateway-account — conta InfinitePay da organizacao (null se ainda nao configurada). */
  async getInfinitePayAccount() {
    const data = await request<{ account: GatewayAccount | null }>("/api/settings/gateway-account", { method: "GET" });
    return data.account;
  },

  /** PATCH /api/settings/gateway-account — cria ou atualiza o InfiniteTag da organizacao. */
  async setInfinitePayHandle(handle: string) {
    const data = await request<{ account: GatewayAccount }>("/api/settings/gateway-account", {
      method: "PATCH",
      body: JSON.stringify({ handle }),
    });
    return data.account;
  },

  /** POST /api/auth/logout — limpa o cookie de sessao. */
  async logout() {
    await request<{ ok: true }>("/api/auth/logout", { method: "POST" });
  },

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

  /** PATCH /api/groups/:groupId */
  async updateGroup(groupId: string, input: UpdateGroupInput) {
    const data = await request<{ group: unknown }>(`/api/groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return data.group;
  },

  /** DELETE /api/groups/:groupId — arquiva (soft delete) e retorna o grupo arquivado. */
  async deleteGroup(groupId: string) {
    const data = await request<{ group: unknown }>(`/api/groups/${groupId}`, {
      method: "DELETE",
    });
    return data.group;
  },

  /** GET /api/groups/:groupId/charges — todas as cobrancas reais do grupo (todos os periodos). */
  async listGroupCharges(groupId: string) {
    const data = await request<{ charges: GroupCharge[] }>(`/api/groups/${groupId}/charges`, { method: "GET" });
    return data.charges;
  },

  /** GET /api/charges?referenceMonth=YYYY-MM — todas as cobrancas reais da organizacao naquele mes. */
  async listOrganizationCharges(referenceMonth: string) {
    const data = await request<{ charges: OrgCharge[] }>(`/api/charges?referenceMonth=${encodeURIComponent(referenceMonth)}`, {
      method: "GET",
    });
    return data.charges;
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

  /** GET /api/groups/:groupId/participants — participantes ativos do grupo. */
  async listGroupParticipants(groupId: string) {
    const data = await request<{ participants: GroupParticipant[] }>(`/api/groups/${groupId}/participants`, {
      method: "GET",
    });
    return data.participants;
  },

  /**
   * POST /api/groups/:groupId/participants — cria (ou reaproveita, por
   * telefone) o participante e ja o vincula ao grupo em uma unica chamada.
   * Nota: o servico hoje ignora `name` quando o participante e novo (ver
   * findOrCreateParticipantByPhone em src/services/participants.ts, que
   * sempre grava name: "") — isso e um gap do backend, nao deste cliente.
   */
  async addParticipant(groupId: string, input: AddParticipantInput) {
    const data = await request<{ participant: unknown }>(`/api/groups/${groupId}/participants`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return data.participant;
  },

  /** DELETE /api/groups/:groupId/participants/:participantId — desvincula (soft) o participante do grupo. */
  async removeParticipant(groupId: string, participantId: string) {
    await request<{ ok: true }>(`/api/groups/${groupId}/participants/${participantId}`, {
      method: "DELETE",
    });
  },

  /** PATCH /api/participants/:participantId */
  async updateParticipant(participantId: string, input: UpdateParticipantInput) {
    const data = await request<{ participant: unknown }>(`/api/participants/${participantId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return data.participant;
  },

  /**
   * GET /api/public/groups/:groupPublicSlug (rota publica, sem sessao).
   * Retorna `null` em 404 (slug inexistente) em vez de lancar, para o
   * chamador conseguir diferenciar "grupo nao encontrado" de um erro de
   * fato (rede, 500, etc), que continua lancando normalmente.
   */
  async getPublicGroupSummary(publicSlug: string): Promise<PublicGroupSummary | null> {
    const response = await fetch(`/api/public/groups/${publicSlug}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (response.status === 404) {
      return null;
    }

    const data = await parseResponseBody(response);
    if (!response.ok) {
      const errorBody = data as ApiErrorBody;
      const message = errorBody.issues?.[0]?.message ?? errorBody.message ?? errorBody.error ?? "Erro desconhecido";
      throw new Error(message);
    }

    return (data as { group: PublicGroupSummary }).group;
  },

  /** GET /api/public/groups/:groupPublicSlug/pending-charges?phone=... (rota publica, sem sessao) */
  async listPendingCharges(groupPublicSlug: string, phone: string) {
    const data = await request<{ pending: PendingCharge[] }>(
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
