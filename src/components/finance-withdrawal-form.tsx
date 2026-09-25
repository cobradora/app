"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Spinner } from "@/components/spinner";

function newIdempotencyKey() {
  return `wd:${(globalThis.crypto ?? crypto).randomUUID()}`;
}

export function FinanceWithdrawalForm({ availableAmount, disabled, disabledReason }: { availableAmount: number; disabled: boolean; disabledReason?: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
  const valid = Number.isInteger(amountCents) && amountCents >= 20 && amountCents <= availableAmount;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.requestWithdrawal({ amountCents, idempotencyKey });
      setSuccess(true);
      setAmount("");
      setIdempotencyKey(newIdempotencyKey());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (disabled) return <p>{disabledReason ?? "Saque indisponível no momento."}</p>;

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="withdrawal-amount">Valor do saque</label>
      <div className="input-prefix">
        <span>R$</span>
        <input id="withdrawal-amount" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^\d,.]/g, "")); setSuccess(false); }} placeholder="0,00" disabled={submitting} />
      </div>
      <p className="field-hint">Disponível: {(availableAmount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Já com os 3% descontados; sem nova taxa no saque.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p role="status">Saque solicitado. Acompanhe o status na lista abaixo.</p>}
      <button type="submit" className="button button--primary" disabled={submitting || !valid}>
        {submitting ? <><Spinner size={18} /><span>Solicitando…</span></> : <span>Solicitar saque</span>}
      </button>
    </form>
  );
}
