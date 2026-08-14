import type { PaymentsAdapter } from "./adapter";
import { createAsaasAdapter } from "./asaas-adapter";
import { createInfinitePayAdapter } from "./infinitepay-adapter";

// Troca de gateway via configuracao, nao via mudanca de codigo (Decisao 3 do
// plano da Fase 6). Default "infinitepay" quando a env var esta ausente ou
// vazia — a Asaas fica em standby e so entra explicitamente.
export function getPaymentsAdapter(provider?: "infinitepay" | "asaas"): PaymentsAdapter {
  const gateway = provider ?? (process.env.PAYMENTS_GATEWAY?.trim() || "infinitepay");
  if (gateway === "asaas") return createAsaasAdapter();
  if (gateway === "infinitepay") return createInfinitePayAdapter();
  throw new Error(`Gateway de pagamentos não suportado: ${gateway}`);
}
