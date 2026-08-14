export type CreateCheckoutInput = {
  organizationId: string;
  participantId: string;
  amount: number; // centavos, valor bruto a cobrar do participante
  splits: { walletId: string; fixedValue: number }[]; // centavos
  dueDate: string;
  idempotencyKey: string;
  // Campos abaixo sao usados apenas pelo InfinitePayAdapter (extensao aditiva;
  // ignorados pelo AsaasAdapter, que continua usando splits[].walletId).
  gatewayExternalAccountId?: string; // handle InfinitePay da organizacao (gatewayAccounts.externalAccountId)
  externalReference?: string; // id da checkoutSession ja persistida, usado como order_nsu
  webhookToken?: string; // segredo em claro (base64url) gerado pelo service; o adapter nao o persiste, so o embute na webhook_url
  buyerName?: string; // nome do participante, para pre-preencher customer.name na InfinitePay
  buyerPhone?: string; // participants.phoneNormalized (+55DDDNNNNNNNNN), para pre-preencher customer.phone_number
};

export type CreateCheckoutResult = {
  gatewayCheckoutId: string;
  checkoutUrl: string;
};

export type GatewayPayment = {
  gatewayPaymentId: string;
  status: "pending" | "confirmed" | "failed" | "refunded";
  amount: number;
  paidAt: string | null;
  paymentMethod: string | null;
};

export type ParsedWebhookEvent = {
  externalEventId: string;
  eventType: string;
  gatewayPaymentId: string;
};

export interface PaymentsAdapter {
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  getPayment(gatewayPaymentId: string): Promise<GatewayPayment>;
  refundPayment(gatewayPaymentId: string, amount?: number): Promise<void>;
  // Retorno assincrono porque o InfinitePayAdapter precisa consultar o
  // webhookTokenHash da checkoutSession no banco (segredo por sessao, nao
  // stateless como o HMAC global do Asaas). `boolean | Promise<boolean>`
  // e uma extensao aditiva: o AsaasAdapter continua retornando `boolean`
  // puro sem qualquer alteracao, ja que boolean e atribuivel ao tipo uniao.
  validateWebhook(rawBody: string, signatureHeader: string | null): boolean | Promise<boolean>;
  parseWebhook(rawBody: string): ParsedWebhookEvent;
}
