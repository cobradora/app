import { Check } from "lucide-react";

export default function PagamentoSucessoPage() {
  return (
    <div className="checkout-fixed">
      <div className="checkout-card">
        <span className="checkout-logo">
          <b /> Groupay
        </span>

        <div className="checkout-check">
          <Check size={24} />
        </div>

        <h1>Pagamento em confirmação</h1>
        <p className="checkout-sub">
          Recebemos seu pagamento e estamos confirmando. Isso pode levar alguns instantes.
        </p>
      </div>
    </div>
  );
}
