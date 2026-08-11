import type { PaymentsAdapter } from "./adapter";
import { createAsaasAdapter } from "./asaas-adapter";
import { createInfinitePayAdapter } from "./infinitepay-adapter";

// Troca de gateway via configuracao, nao via mudanca de codigo (Decisao 3 do
// plano da Fase 6). Default "infinitepay" quando a env var esta ausente ou
// vazia — a Asaas fica em standby e so entra explicitamente.
export function getPaymentsAdapter(): PaymentsAdapter {
  const gateway = process.env.PAYMENTS_GATEWAY?.trim() || "infinitepay";
  if (gateway === "asaas") return createAsaasAdapter();
  return createInfinitePayAdapter();
}
