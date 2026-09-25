"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toDataURL } from "qrcode";
import Link from "next/link";

type Deposit = { id: string; amount: number; status: string; pixCopyPaste: string | null; reconciliationRequired: boolean; reconciliationUnavailable: boolean };
export default function PixPaymentPage() {
  const { depositId } = useParams<{ depositId: string }>();
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const storageKey = `xgate-pix:${depositId}`;
    const fragment = window.location.hash.slice(1);
    let token = fragment;
    let stored = false;
    try {
      token ||= sessionStorage.getItem(storageKey) ?? "";
      if (fragment) sessionStorage.setItem(storageKey, fragment);
      stored = true;
    } catch { /* the fragment still works when sessionStorage is unavailable */ }
    if (fragment && stored) window.history.replaceState({}, "", window.location.pathname);
    if (!token) { setError("Abra o link de pagamento original para consultar este Pix."); return; }
    async function refresh() {
      let terminal = false;
      try {
        const response = await fetch(`/api/public/xgate-deposits/${depositId}/payment-check`, { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "Não foi possível consultar o pagamento.");
        if (active) { setDeposit(data.deposit); setError(""); }
        terminal = ["confirmed", "failed", "refunded"].includes(data.deposit.status);
      } catch (cause) { if (active) setError((cause as Error).message); }
      if (active && !terminal) timer = setTimeout(refresh, 10000);
    }
    void refresh();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [depositId]);
  useEffect(() => {
    let active = true;
    setQr("");
    if (deposit?.pixCopyPaste) void toDataURL(deposit.pixCopyPaste, { width: 280, margin: 4 }).then(value => { if (active) setQr(value); }).catch(() => { /* copia e cola remains usable */ });
    return () => { active = false; };
  }, [deposit?.pixCopyPaste]);
  const confirmed = deposit?.status === "confirmed";
  return <main className="checkout-fixed"><section className="checkout-card" aria-labelledby="pix-title">
    <p className="eyebrow">Pagamento Pix</p>
    <h1 id="pix-title">{confirmed ? "Pagamento confirmado" : deposit?.status === "failed" ? "Pix não gerado" : "Pague com Pix"}</h1>
    {deposit && <h2>{(deposit.amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</h2>}
    {confirmed && <p role="status">A cobrança foi quitada e o recebimento foi registrado para a organização.</p>}
    {deposit?.status === "failed" && <p>Não foi possível gerar o Pix. Volte à lista de cobranças para iniciar outra tentativa.</p>}
    {deposit?.reconciliationRequired && <p role="status">Esta tentativa está em conciliação. Aguarde a confirmação ou fale com o organizador antes de iniciar outro pagamento.</p>}
    {deposit?.reconciliationUnavailable && <p role="status">A confirmação está temporariamente indisponível. Se já pagou, aguarde; não faça outro pagamento.</p>}
    {qr && <div style={{ textAlign: "center" }}>{/* Generated locally from the Pix code; no external image service. */}<img src={qr} width={280} height={280} alt="QR Code para pagar com Pix" /></div>}
    {deposit?.pixCopyPaste && <>
      <p>Pague com uma conta bancária do mesmo CPF/CNPJ informado.</p>
      <label htmlFor="pix-code">Pix Copia e Cola</label>
      <textarea id="pix-code" readOnly value={deposit.pixCopyPaste} rows={4} style={{ width: "100%", overflowWrap: "anywhere" }} />
      <button className="button button--primary button--full" onClick={async () => { try { await navigator.clipboard.writeText(deposit.pixCopyPaste!); setCopied(true); } catch { setError("Selecione e copie o código no campo acima."); } }}>{copied ? "Código copiado" : "Copiar código Pix"}</button>
      <p className="checkout-hint">A página acompanha a confirmação automaticamente.</p>
    </>}
    {!deposit && !error && <p role="status">Consultando pagamento…</p>}
    {error && <p role="alert">{error}</p>}
    <Link href="/" className="link">Voltar ao início</Link>
  </section></main>;
}
