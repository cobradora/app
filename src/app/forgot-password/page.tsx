"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Mail } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-orb auth-orb--one" />
      <div className="auth-orb auth-orb--two" />
      <main className="auth-card">
        <Link className="auth-brand" href="/" aria-label="CobraDora — início">
          <Image src={cobraLogo} alt="" width={74} height={74} priority />
          <span><strong>CobraDora</strong><small>Assistente de Cobranças</small></span>
        </Link>

        <div className="auth-heading">
          <span className="auth-chip"><Mail size={15} /> Recuperar acesso</span>
          <h1>Esqueceu sua senha?</h1>
          <p>Informe o e-mail da sua conta e enviaremos um link para redefinir a senha.</p>
        </div>

        {sent ? (
          <p className="modal-copy">Se esse e-mail estiver cadastrado, você vai receber um link de redefinição em instantes. Confira também a caixa de spam.</p>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="email">E-mail</label>
            <div className="auth-input">
              <input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@exemplo.com"
                required
                autoFocus
              />
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}

            <button type="submit" className="button button--primary button--full auth-submit" disabled={submitting || !email.trim()}>
              {submitting ? "Enviando…" : <><span>Enviar link</span><ArrowRight size={18} /></>}
            </button>
          </form>
        )}

        <p className="auth-switch">
          Lembrou a senha? <Link href="/login">Entrar</Link>
        </p>
      </main>
    </div>
  );
}
