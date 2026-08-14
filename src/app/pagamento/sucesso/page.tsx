"use client";

import Image from "next/image";
import { Check, Clock3, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import cobradoraLogo from "@/images/logo-horizontal-sem-fundo.png";

type ReturnDetails = {
  sessionId: string;
  recoveryToken: string;
  transactionNsu: string;
  invoiceSlug: string;
};

type VerificationState =
  | { kind: "verifying" }
  | { kind: "confirmed" }
  | { kind: "pending" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

function readReturnDetails(): ReturnDetails | null {
  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("order_nsu") ?? query.get("session_id");
  const recoveryToken = query.get("recovery_token");
  const transactionNsu = query.get("transaction_nsu");
  const invoiceSlug = query.get("slug") ?? query.get("invoice_slug");
  if (!sessionId || !recoveryToken || !transactionNsu || !invoiceSlug) return null;
  return { sessionId, recoveryToken, transactionNsu, invoiceSlug };
}

export default function PagamentoSucessoPage() {
  const [details, setDetails] = useState<ReturnDetails | null>(null);
  const [state, setState] = useState<VerificationState>({ kind: "verifying" });

  const verifyPayment = useCallback(async (returnDetails: ReturnDetails) => {
    setState({ kind: "verifying" });
    try {
      const response = await fetch(
        `/api/public/checkout-sessions/${encodeURIComponent(returnDetails.sessionId)}/payment-check`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recoveryToken: returnDetails.recoveryToken,
            transactionNsu: returnDetails.transactionNsu,
            invoiceSlug: returnDetails.invoiceSlug,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { payment?: { status?: "pending" | "confirmed" }; error?: string }
        | null;

      if (response.status === 401 || response.status === 400) {
        setState({ kind: "invalid" });
      } else if (!response.ok) {
        setState({ kind: "unavailable" });
      } else if (body?.payment?.status === "confirmed") {
        setState({ kind: "confirmed" });
      } else {
        setState({ kind: "pending" });
      }
    } catch {
      setState({ kind: "unavailable" });
    }
  }, []);

  useEffect(() => {
    const returnDetails = readReturnDetails();
    let active = true;
    // O token de recuperação não precisa permanecer no histórico, em logs de
    // navegação ou em um Referer depois que já foi capturado em memória.
    window.history.replaceState({}, "", "/pagamento/sucesso");
    queueMicrotask(() => {
      if (!active) return;
      if (!returnDetails) {
        setState({ kind: "invalid" });
        return;
      }
      setDetails(returnDetails);
      void verifyPayment(returnDetails);
    });
    return () => {
      active = false;
    };
  }, [verifyPayment]);

  return (
    <main className="checkout-fixed">
      <section className="checkout-card" aria-labelledby="payment-status-title" aria-live="polite">
        <div className="checkout-logo" aria-label="CobraDora">
          <Image src={cobradoraLogo} alt="CobraDora" priority sizes="180px" style={{ width: 180, height: "auto" }} />
        </div>

        {state.kind === "verifying" && (
          <>
            <div className="checkout-check" aria-hidden="true">
              <Clock3 size={24} />
            </div>
            <h1 id="payment-status-title">Confirmando com a InfinitePay</h1>
            <p className="checkout-sub">Aguarde alguns instantes. Não feche esta página durante a verificação.</p>
          </>
        )}

        {state.kind === "confirmed" && (
          <>
            <div className="checkout-check" aria-hidden="true">
              <Check size={24} />
            </div>
            <h1 id="payment-status-title">Pagamento confirmado</h1>
            <p className="checkout-sub">Tudo certo. A CobraDora já registrou a baixa da sua cobrança.</p>
          </>
        )}

        {state.kind === "pending" && (
          <>
            <div className="checkout-check" aria-hidden="true">
              <Clock3 size={24} />
            </div>
            <h1 id="payment-status-title">Pagamento ainda em confirmação</h1>
            <p className="checkout-sub">
              A InfinitePay ainda não confirmou o pagamento. Nenhuma cobrança foi marcada como paga antecipadamente.
            </p>
            {details && (
              <button type="button" className="solid full" onClick={() => void verifyPayment(details)}>
                Verificar novamente
              </button>
            )}
          </>
        )}

        {state.kind === "invalid" && (
          <>
            <div className="checkout-check" aria-hidden="true">
              <ShieldAlert size={24} />
            </div>
            <h1 id="payment-status-title">Não foi possível validar o retorno</h1>
            <p className="checkout-sub">
              Por segurança, esta página não confirma pagamentos sem os dados válidos da InfinitePay.
            </p>
          </>
        )}

        {state.kind === "unavailable" && (
          <>
            <div className="checkout-check" aria-hidden="true">
              <Clock3 size={24} />
            </div>
            <h1 id="payment-status-title">Verificação temporariamente indisponível</h1>
            <p className="checkout-sub">Seu pagamento não foi baixado sem confirmação. Tente novamente em instantes.</p>
            {details && (
              <button type="button" className="solid full" onClick={() => void verifyPayment(details)}>
                Tentar novamente
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
