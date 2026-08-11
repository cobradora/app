export type CreateCheckoutInput = {
  organizationId: string;
  participantId: string;
  amount: number; // centavos, valor bruto a cobrar do participante
  splits: { walletId: string; fixedValue: number }[]; // centavos
  dueDate: string;
  idempotencyKey: string;
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
  validateWebhook(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhook(rawBody: string): ParsedWebhookEvent;
}
