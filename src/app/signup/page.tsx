"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";

export default function SignupPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.signup({ organizationName, name, email, password });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const canSubmit =
    organizationName.trim() && name.trim() && email.trim() && password.trim().length >= 8;

  return (
    <div className="checkout-fixed">
      <div className="checkout-card">
        <span className="checkout-logo">
          <b /> Groupay
        </span>

        <h1>Criar conta</h1>
        <p className="checkout-sub">Crie sua organização para começar a usar o Groupay.</p>

        <form onSubmit={handleSubmit}>
          <label className="checkout-label" htmlFor="organizationName">
            Nome da organização
          </label>
          <div className="checkout-input">
            <input
              id="organizationName"
              type="text"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              required
              autoFocus
            />
          </div>

          <label className="checkout-label" htmlFor="name">
            Seu nome
          </label>
          <div className="checkout-input">
            <input id="name" type="text" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>

          <label className="checkout-label" htmlFor="email">
            Email
          </label>
          <div className="checkout-input">
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <label className="checkout-label" htmlFor="password">
            Senha
          </label>
          <div className="checkout-input">
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>

          {error && <p className="modal-error">{error}</p>}

          <button type="submit" className="solid full" disabled={submitting || !canSubmit}>
            {submitting ? "Criando…" : "Criar conta"}
          </button>
        </form>

        <p className="checkout-hint">
          Já tem conta? <Link className="link" href="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
