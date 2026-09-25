"use client";
import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { formatPhoneInput, isValidPhone } from "@/lib/phone";
type Charge = { chargeId: string; participantName: string; totalAmount: number; referenceMonth: string; payerName: string };
const money = (amount: number) => (amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export default function XGateGroupCheckoutPage() {
  const { publicSlug } = useParams<{ publicSlug: string }>();
  const [phone, setPhone] = useState("");
  const [charges, setCharges] = useState<Charge[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/public/groups/${publicSlug}/pending-charges`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const data = await response.json();
      if (!response.ok) throw new Error("Não foi possível consultar as cobranças.");
      setCharges(data.pending ?? []); setName(data.pending?.[0]?.payerName ?? ""); setSelected([]); setKey("");
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function pay(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    // The server also recovers by fingerprint. Keep the key across network errors.
    const idempotencyKey = key || crypto.randomUUID(); setKey(idempotencyKey);
    try {
      const response = await fetch(`/api/public/groups/${publicSlug}/xgate-checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, name, document, chargeIds: selected, idempotencyKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Pix indisponível.");
      window.location.assign(data.checkout.checkoutUrl);
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  const total = (charges ?? []).filter(charge => selected.includes(charge.chargeId)).reduce((sum, charge) => sum + charge.totalAmount, 0);
  return <main className="checkout-fixed"><section className="checkout-card">
    <p className="eyebrow">CobraDora · Pix</p><h1>Pagar mensalidades</h1>
    {charges === null ? <form onSubmit={search} className="auth-form"><label htmlFor="payer-phone">Telefone cadastrado</label><input id="payer-phone" type="tel" value={phone} onChange={event => setPhone(formatPhoneInput(event.target.value))} required disabled={busy} /><button className="button button--primary" disabled={busy || !isValidPhone(phone)}>{busy ? "Consultando…" : "Consultar cobranças"}</button></form> : <form onSubmit={pay} className="auth-form">
      {!charges.length && <p>Nenhuma cobrança aberta para este telefone.</p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><legend>Cobranças</legend>{charges.map(charge => <label key={charge.chargeId} className="charge-row"><input type="checkbox" checked={selected.includes(charge.chargeId)} onChange={event => { setSelected(ids => event.target.checked ? [...ids, charge.chargeId] : ids.filter(id => id !== charge.chargeId)); setKey(""); }} /><span>{charge.participantName} · {charge.referenceMonth}</span><strong>{money(charge.totalAmount)}</strong></label>)}</fieldset>
      {charges.length > 0 && <><label htmlFor="payer-name">Nome completo ou razão social do pagador</label><input id="payer-name" value={name} maxLength={200} required disabled={busy} onChange={event => { setName(event.target.value); setKey(""); }} />
      <label htmlFor="payer-document">CPF ou CNPJ do pagador</label><input id="payer-document" inputMode="numeric" autoComplete="off" value={document} maxLength={18} required disabled={busy} onChange={event => { setDocument(event.target.value); setKey(""); }} />
      <p className="checkout-hint">Os dados serão enviados à XGate para identificar o pagador. Use uma conta bancária do mesmo titular.</p>
      <button className="button button--primary button--full" disabled={busy || !selected.length || !document || !name}>{busy ? "Preparando Pix…" : `Gerar Pix de ${money(total)}`}</button></>}
      <button type="button" className="link" disabled={busy} onClick={() => { setCharges(null); setDocument(""); setError(""); }}>Trocar telefone</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
