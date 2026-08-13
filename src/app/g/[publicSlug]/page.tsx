"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { apiClient, type PendingCharge } from "@/lib/api-client";

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDueDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function formatReferenceMonth(ref: string): string {
  const [year, month] = ref.split("-");
  const index = Number(month) - 1;
  const name = MONTH_NAMES[index];
  return name ? `${name}/${year}` : ref;
}

/** Mascara leve de exibicao — a normalizacao "de verdade" acontece no backend. */
function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

type GroupSummaryState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "ready"; name: string };

export default function PublicGroupPage() {
  const params = useParams<{ publicSlug: string }>();
  const publicSlug = params.publicSlug;

  const [group, setGroup] = useState<GroupSummaryState>({ kind: "loading" });

  const [phone, setPhone] = useState("");
  const [loadingCharges, setLoadingCharges] = useState(false);
  const [chargesError, setChargesError] = useState<string | null>(null);
  const [charges, setCharges] = useState<PendingCharge[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .getPublicGroupSummary(publicSlug)
      .then((summary) => {
        if (!active) return;
        if (!summary) {
          setGroup({ kind: "not_found" });
        } else if (summary.status === "archived") {
          setGroup({ kind: "archived" });
        } else {
          setGroup({ kind: "ready", name: summary.name });
        }
      })
      .catch(() => {
        if (active) setGroup({ kind: "not_found" });
      });
    return () => {
      active = false;
    };
  }, [publicSlug]);

  async function handleSearchCharges(event: FormEvent) {
    event.preventDefault();
    setChargesError(null);
    setCheckoutError(null);
    setLoadingCharges(true);
    setCharges(null);
    setSelected(new Set());
    setIdempotencyKey(null);
    try {
      const pending = await apiClient.listPendingCharges(publicSlug, phone);
      setCharges(pending);
    } catch (err) {
      setChargesError((err as Error).message);
    } finally {
      setLoadingCharges(false);
    }
  }

  function toggleCharge(chargeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chargeId)) {
        next.delete(chargeId);
      } else {
        next.add(chargeId);
      }
      return next;
    });
    // A selecao mudou: descarta a idempotencyKey anterior para nao
    // reaproveitar uma sessao criada para um conjunto diferente de charges.
    setIdempotencyKey(null);
    setCheckoutError(null);
  }

  function handleChangePhone() {
    setCharges(null);
    setSelected(new Set());
    setChargesError(null);
    setCheckoutError(null);
    setIdempotencyKey(null);
  }

  const selectedCharges = (charges ?? []).filter((charge) => selected.has(charge.chargeId));
  const totalSelected = selectedCharges.reduce((sum, charge) => sum + charge.totalAmount, 0);

  async function handleCheckout() {
    if (selectedCharges.length === 0) return;
    setSubmitting(true);
    setCheckoutError(null);
    // Reaproveita a key ja gerada se o usuario tentar de novo sem mudar a
    // selecao (evita criar uma segunda sessao de checkout num retry).
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    try {
      const result = await apiClient.createCheckout(
        publicSlug,
        phone,
        selectedCharges.map((charge) => charge.chargeId),
        key,
      );
      window.location.assign(result.checkoutUrl);
    } catch (err) {
      setCheckoutError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="checkout-fixed">
      <div className="checkout-card">
        <span className="checkout-logo">
          <b /> Groupay
        </span>

        {group.kind === "loading" && (
          <p className="checkout-sub" style={{ marginTop: 20 }}>
            Carregando...
          </p>
        )}

        {group.kind === "not_found" && (
          <>
            <h1>Link inválido</h1>
            <p className="checkout-sub">Este link não corresponde a nenhum grupo. Confira o link com o organizador.</p>
          </>
        )}

        {group.kind === "archived" && (
          <>
            <h1>Link inativo</h1>
            <p className="checkout-sub">Este link não está mais ativo. Fale com o organizador para mais informações.</p>
          </>
        )}

        {group.kind === "ready" && (
          <>
            <h1>{group.name}</h1>

            {charges === null && (
              <>
                <p className="checkout-sub">Informe seu telefone para ver suas cobranças em aberto neste grupo.</p>
                <form onSubmit={handleSearchCharges}>
                  <label className="checkout-label" htmlFor="phone">
                    Telefone
                  </label>
                  <div className="checkout-input">
                    <input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      placeholder="(11) 99999-9999"
                      value={phone}
                      onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
                      required
                    />
                  </div>
                  {chargesError && <p className="modal-error">{chargesError}</p>}
                  <button type="submit" className="solid full" disabled={loadingCharges || phone.replace(/\D/g, "").length < 10}>
                    {loadingCharges ? "Buscando..." : "Ver cobranças"}
                  </button>
                </form>
              </>
            )}

            {charges !== null && charges.length === 0 && (
              <>
                <p className="checkout-sub">
                  Não encontramos cobranças em aberto para esse número neste grupo. Confira o número ou fale com o
                  organizador.
                </p>
                <button type="button" className="solid full" onClick={handleChangePhone}>
                  Tentar outro telefone
                </button>
              </>
            )}

            {charges !== null && charges.length > 0 && (
              <>
                <p className="checkout-sub">Selecione as cobranças que deseja pagar agora.</p>

                {charges.map((charge) => (
                  <label key={charge.chargeId} className="charge-row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(charge.chargeId)}
                      onChange={() => toggleCharge(charge.chargeId)}
                    />
                    <div className="charge-info">
                      <strong>{formatReferenceMonth(charge.referenceMonth)}</strong>
                      <small>Vencimento: {formatDueDate(charge.dueDate)}</small>
                    </div>
                    <span className="charge-amount">{formatBRL(charge.totalAmount)}</span>
                  </label>
                ))}

                {checkoutError && <p className="modal-error">{checkoutError}</p>}

                <button type="button" className="solid full" disabled={selectedCharges.length === 0 || submitting} onClick={handleCheckout}>
                  {submitting ? "Redirecionando..." : `Pagar ${formatBRL(totalSelected)}`}
                </button>

                <p className="checkout-hint">
                  <button type="button" className="link" onClick={handleChangePhone}>
                    Trocar telefone
                  </button>
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
