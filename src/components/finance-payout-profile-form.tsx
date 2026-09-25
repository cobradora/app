"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiClient, type PixKeyType } from "@/lib/api-client";
import { Spinner } from "@/components/spinner";

const PIX_KEY_LABELS: Record<PixKeyType, string> = { CPF: "CPF", CNPJ: "CNPJ", EMAIL: "E-mail", PHONE: "Celular", RANDOM: "Chave aleatória" };
const PIX_KEY_HINTS: Record<PixKeyType, string> = {
  CPF: "Informe o CPF do titular cadastrado como chave Pix no banco.",
  CNPJ: "Informe o CNPJ do titular cadastrado como chave Pix no banco.",
  EMAIL: "Informe o e-mail cadastrado como chave Pix na conta do titular.",
  PHONE: "Informe o celular cadastrado como chave Pix, com código do país e DDD (ex.: +5511999999999).",
  RANDOM: "Copie a chave aleatória completa no aplicativo do banco do titular.",
};

export type PayoutProfileSummary = { name: string; pixKeyType: PixKeyType; pixKey: string; status: string } | null;

function maskPixKey(type: PixKeyType, key: string) {
  if (type === "EMAIL") { const [user, domain] = key.split("@"); return domain ? `${user.slice(0, 2)}***@${domain}` : key; }
  if (type === "CPF" || type === "CNPJ" || type === "PHONE") return `${"*".repeat(Math.max(key.length - 4, 0))}${key.slice(-4)}`;
  return `${key.slice(0, 8)}…`;
}

export function FinancePayoutProfileForm({ profile }: { profile: PayoutProfileSummary }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!profile || profile.status !== "active");
  const [name, setName] = useState(profile?.name ?? "");
  const [document, setDocument] = useState("");
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>(profile?.pixKeyType ?? "CPF");
  const [pixKey, setPixKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.registerPayoutProfile({ name, document, pixKeyType, pixKey });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing && profile) {
    return (
      <div>
        <p>Recebendo em {PIX_KEY_LABELS[profile.pixKeyType]}: <strong>{maskPixKey(profile.pixKeyType, profile.pixKey)}</strong></p>
        <button type="button" className="link" onClick={() => setEditing(true)}>Trocar chave Pix</button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <p>Cadastre a chave Pix que vai receber os saques desta organização.</p>
      <p>Informe o nome e o CPF ou CNPJ do titular da conta que receberá os saques. A chave Pix deve pertencer ao mesmo titular.</p>
      <label htmlFor="payout-name">Nome do titular</label>
      <div className="auth-input">
        <input id="payout-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={200} required disabled={submitting} />
      </div>
      <label htmlFor="payout-document">CPF/CNPJ do titular</label>
      <div className="auth-input">
        <input id="payout-document" value={document} onChange={(event) => setDocument(event.target.value)} maxLength={25} required disabled={submitting} placeholder="000.000.000-00" />
      </div>
      <label htmlFor="payout-pix-key-type">Tipo de chave Pix</label>
      <div className="auth-input">
        <select id="payout-pix-key-type" value={pixKeyType} onChange={(event) => { setPixKeyType(event.target.value as PixKeyType); setError(null); }} disabled={submitting}>
          {(Object.keys(PIX_KEY_LABELS) as PixKeyType[]).map((type) => <option key={type} value={type}>{PIX_KEY_LABELS[type]}</option>)}
        </select>
      </div>
      <label htmlFor="payout-pix-key">Chave Pix</label>
      <div className="auth-input">
        <input id="payout-pix-key" value={pixKey} onChange={(event) => setPixKey(event.target.value)} maxLength={320} required disabled={submitting} aria-describedby="payout-pix-key-hint" />
      </div>
      <p id="payout-pix-key-hint">{PIX_KEY_HINTS[pixKeyType]}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="button button--primary" disabled={submitting || !name.trim() || !document.trim() || !pixKey.trim()}>
        {submitting ? <><Spinner size={18} /><span>Salvando…</span></> : <span>Salvar chave Pix</span>}
      </button>
      {profile?.status === "active" && <button type="button" className="link" onClick={() => setEditing(false)} disabled={submitting}>Cancelar</button>}
    </form>
  );
}
