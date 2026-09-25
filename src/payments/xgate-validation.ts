import { xgateAmountToCents, type XGateTransactionDetails } from "./xgate-client";

export function normalizeBrazilianDocument(input: string): string {
  const document = input.replace(/[.\-/\s]/g, "");
  if (!/^\d{11}$|^\d{14}$/.test(document) || /^(\d)\1+$/.test(document)) throw new Error("Documento inválido");
  const digits = [...document].map(Number);
  for (let position = digits.length - 2; position < digits.length; position++) {
    let total = 0;
    for (let i = 0; i < position; i++) {
      const weight = digits.length === 11 ? position + 1 - i : ((position - 1 - i) % 8) + 2;
      total += digits[i] * weight;
    }
    const remainder = total % 11;
    if (digits[position] !== (remainder < 2 ? 0 : 11 - remainder)) throw new Error("Documento inválido");
  }
  return document;
}

/** Missing identity evidence is never interpreted as confirmation. Shared shape for
 * deposit and withdrawal details, both returned by the same XGate details contract. */
export function assertTransactionEvidence(details: XGateTransactionDetails, expected: {
  transactionId: string; externalId: string; customerId: string; amount: number; requireExternalId?: boolean;
}): void {
  if (details._id !== expected.transactionId ||
    ((expected.requireExternalId || details.externalId !== undefined) && details.externalId !== expected.externalId) ||
    details.customerId !== expected.customerId || details.currency.name !== "BRL" ||
    details.currency.type !== "PIX" || details.cryptocurrency != null || xgateAmountToCents(details.currency.amount) !== expected.amount) {
    throw new Error("Dados da transação XGate divergentes ou incompletos");
  }
}
/** @deprecated use assertTransactionEvidence */
export const assertDepositEvidence = assertTransactionEvidence;

export function isPaidTransaction(details: XGateTransactionDetails): boolean {
  return details.currency.status === "PAID" && (!details.status || details.status === "PAID");
}
/** Deposit settlement is currency.status, not the platform's top-level approval status. */
export function isPaidDeposit(details: XGateTransactionDetails): boolean {
  return details.currency.status === "PAID";
}
