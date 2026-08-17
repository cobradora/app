"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { apiClient, ApiError } from "@/lib/api-client";
import { parsePhoneBR, PHONE_INPUT_MAX_LENGTH } from "@/lib/phone";
import { Spinner } from "@/components/spinner";
import cobradoraLogo from "@/images/logo-horizontal-sem-fundo.png";

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type PendingCharge = {
  chargeId: string;
  participantId: string;
  participantName: string;
  payerName: string;
  totalAmount: number;
  dueDate: string;
  referenceMonth: string;
};

type GroupSummaryState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "ready"; name: string };

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDueDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function formatReferenceMonth(referenceMonth: string): string {
  const [year, month] = referenceMonth.split("-");
  const monthName = MONTH_NAMES[Number(month) - 1];
  return monthName ? `${monthName}/${year}` : referenceMonth;
}

function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length === 13 ? digits.slice(2) : digits;
  const limited = local.slice(0, 11);
  if (limited.length <= 2) return limited;
  if (limited.length <= 7) return `(${limited.slice(0, 2)}) ${limited.slice(2)}`;
  return `(${limited.slice(0, 2)}) ${limited.slice(2, 7)}-${limited.slice(7)}`;
}

function isValidPhone(value: string): boolean {
  try {
    parsePhoneBR(value);
    return true;
  } catch {
    return false;
  }
}

async function lookupPendingCharges(publicSlug: string, phone: string): Promise<PendingCharge[]> {
  const response = await fetch(`/api/public/groups/${encodeURIComponent(publicSlug)}/pending-charges`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const body = (await response.json().catch(() => null)) as { pending?: PendingCharge[]; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? "Não foi possível consultar as cobranças");
  return body?.pending ?? [];
}

export default function PublicGroupPage() {
  const { publicSlug } = useParams<{ publicSlug: string }>();
  const [group, setGroup] = useState<GroupSummaryState>({ kind: "loading" });
  const [phone, setPhone] = useState("");
  const [loadingCharges, setLoadingCharges] = useState(false);
  const [chargesError, setChargesError] = useState<string | null>(null);
  const [charges, setCharges] = useState<PendingCharge[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutBlocked, setCheckoutBlocked] = useState(false);
  const [recoveredCheckoutUrl, setRecoveredCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .getPublicGroupSummary(publicSlug)
      .then((summary) => {
        if (!active) return;
        if (!summary) setGroup({ kind: "not_found" });
        else if (summary.status === "archived") setGroup({ kind: "archived" });
        else setGroup({ kind: "ready", name: summary.name });
      })
      .catch(() => active && setGroup({ kind: "not_found" }));
    return () => {
      active = false;
    };
  }, [publicSlug]);

  async function handleSearchCharges(event: FormEvent) {
    event.preventDefault();
    setChargesError(null);
    setCheckoutError(null);
    if (!isValidPhone(phone)) {
      setChargesError("Informe um celular brasileiro válido com DDD.");
      return;
    }
    setLoadingCharges(true);
    setCharges(null);
    setSelected(new Set());
    setIdempotencyKey(null);
    try {
      setCharges(await lookupPendingCharges(publicSlug, phone));
    } catch {
      setChargesError("Não foi possível consultar agora. Tente novamente.");
    } finally {
      setLoadingCharges(false);
    }
  }

  function toggleCharge(chargeId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(chargeId)) next.delete(chargeId);
      else next.add(chargeId);
      return next;
    });
    setIdempotencyKey(null);
    setCheckoutError(null);
    setCheckoutBlocked(false);
    setRecoveredCheckoutUrl(null);
  }

  function handleChangePhone() {
    setCharges(null);
    setSelected(new Set());
    setChargesError(null);
    setCheckoutError(null);
    setIdempotencyKey(null);
    setCheckoutBlocked(false);
    setRecoveredCheckoutUrl(null);
  }

  const selectedCharges = (charges ?? []).filter((charge) => selected.has(charge.chargeId));
  const totalSelected = selectedCharges.reduce((sum, charge) => sum + charge.totalAmount, 0);
  const payerName = charges?.[0]?.payerName;

  async function handleCheckout(resetBlocked = false) {
    if (selectedCharges.length === 0) return;
    setSubmitting(true);
    setCheckoutError(null);
    setCheckoutBlocked(false);
    setRecoveredCheckoutUrl(null);
    // Um reset precisa de uma chave nova: reaproveitar a mesma faria o
    // backend achar a sessão travada de novo pela idempotencyKey.
    const key = resetBlocked ? crypto.randomUUID() : (idempotencyKey ?? crypto.randomUUID());
    setIdempotencyKey(key);
    try {
      const result = await apiClient.createCheckout(
        publicSlug,
        phone,
        selectedCharges.map((charge) => charge.chargeId),
        key,
        resetBlocked,
      );
      if (result.recovered === "started_new") {
        setRecoveredCheckoutUrl(result.checkoutUrl);
        setSubmitting(false);
      } else {
        window.location.assign(result.checkoutUrl);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "checkout_reconciliation_required") {
        setCheckoutBlocked(true);
      }
      setCheckoutError((error as Error).message || "Não foi possível abrir o checkout");
      setSubmitting(false);
    }
  }

  return (
    <main className="checkout-fixed">
      <section className="checkout-card" aria-labelledby="checkout-title">
        <div className="checkout-logo" aria-label="CobraDora">
          <Image src={cobradoraLogo} alt="CobraDora" priority sizes="180px" style={{ width: 180, height: "auto" }} />
        </div>

        {group.kind === "loading" && (
          <p className="checkout-sub" role="status" aria-live="polite" style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            <Spinner /> Carregando o grupo…
          </p>
        )}

        {group.kind === "not_found" && (
          <>
            <h1 id="checkout-title">Link indisponível</h1>
            <p className="checkout-sub">Confira o endereço recebido ou peça um novo link ao organizador.</p>
          </>
        )}

        {group.kind === "archived" && (
          <>
            <h1 id="checkout-title">Link inativo</h1>
            <p className="checkout-sub">Este grupo não recebe mais pagamentos por este link.</p>
          </>
        )}

        {group.kind === "ready" && (
          <>
            <h1 id="checkout-title">{group.name}</h1>

            {charges === null && (
              <>
                <p className="checkout-sub">Use o telefone do responsável financeiro para consultar as pendências.</p>
                <form onSubmit={handleSearchCharges} noValidate>
                  <label className="checkout-label" htmlFor="phone">
                    Telefone do responsável
                  </label>
                  <div className="checkout-input">
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={PHONE_INPUT_MAX_LENGTH}
                      placeholder="(11) 99999-9999"
                      value={phone}
                      onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
                      aria-describedby={chargesError ? "charges-error" : undefined}
                      required
                    />
                  </div>
                  {chargesError && (
                    <p id="charges-error" className="modal-error" role="alert">
                      {chargesError}
                    </p>
                  )}
                  <button
                    type="submit"
                    className="button button--primary button--full"
                    disabled={loadingCharges || !isValidPhone(phone)}
                  >
                    {loadingCharges ? <><Spinner /> Consultando…</> : "Ver cobranças"}
                  </button>
                </form>
              </>
            )}

            {charges !== null && charges.length === 0 && (
              <>
                <p className="checkout-sub" role="status">
                  Não há cobranças abertas para este telefone neste grupo. Confira o número ou fale com o organizador.
                </p>
                <button type="button" className="button button--primary button--full" onClick={handleChangePhone}>
                  Consultar outro telefone
                </button>
              </>
            )}

            {charges !== null && charges.length > 0 && (
              <>
                <p className="checkout-sub">
                  {payerName ? (
                    <>
                      Responsável financeiro: <strong>{payerName}</strong>. Selecione o que deseja pagar.
                    </>
                  ) : (
                    "Selecione o que deseja pagar."
                  )}
                </p>

                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      padding: 0,
                      margin: -1,
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      whiteSpace: "nowrap",
                      border: 0,
                    }}
                  >
                    Cobranças abertas
                  </legend>
                  {charges.map((charge) => (
                    <label key={charge.chargeId} className="charge-row" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(charge.chargeId)}
                        onChange={() => toggleCharge(charge.chargeId)}
                      />
                      <span className="charge-info">
                        <strong>{charge.participantName}</strong>
                        <small>
                          {formatReferenceMonth(charge.referenceMonth)} · vence em {formatDueDate(charge.dueDate)}
                        </small>
                      </span>
                      <span className="charge-amount">{formatBRL(charge.totalAmount)}</span>
                    </label>
                  ))}
                </fieldset>

                {checkoutError && (
                  <p className="modal-error" role="alert" aria-live="assertive">
                    {checkoutError}
                  </p>
                )}

                {recoveredCheckoutUrl ? (
                  <>
                    <p className="checkout-sub" role="status">
                      Se você já pagou por uma tentativa anterior deste mesmo grupo, fale com o organizador antes de pagar de novo.
                    </p>
                    <button type="button" className="button button--primary button--full" onClick={() => window.location.assign(recoveredCheckoutUrl)}>
                      Continuar para pagamento
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button button--primary button--full"
                    disabled={selectedCharges.length === 0 || submitting}
                    onClick={() => handleCheckout()}
                  >
                    {submitting ? <><Spinner /> Preparando checkout…</> : `Pagar ${formatBRL(totalSelected)}`}
                  </button>
                )}

                {checkoutBlocked && !recoveredCheckoutUrl && (
                  <button
                    type="button"
                    className="button button--primary button--full"
                    disabled={submitting}
                    onClick={() => handleCheckout(true)}
                  >
                    {submitting ? <><Spinner /> Gerando…</> : "Gerar novo link de pagamento"}
                  </button>
                )}

                <p className="checkout-hint">
                  O pagamento só será baixado após a confirmação segura da InfinitePay.
                </p>
                <button type="button" className="link" onClick={handleChangePhone}>
                  Trocar telefone
                </button>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
