"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.login({ email, password });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="checkout-fixed">
      <div className="checkout-card">
        <span className="checkout-logo">
          <b /> Groupay
        </span>

        <h1>Entrar</h1>
        <p className="checkout-sub">Acesse o painel da sua organização.</p>

        <form onSubmit={handleSubmit}>
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
              autoFocus
            />
          </div>

          <label className="checkout-label" htmlFor="password">
            Senha
          </label>
          <div className="checkout-input">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error && <p className="modal-error">{error}</p>}

          <button type="submit" className="solid full" disabled={submitting || !email.trim() || !password.trim()}>
            {submitting ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="checkout-hint">
          Não tem conta? <Link className="link" href="/signup">Criar conta</Link>
        </p>
      </div>
    </div>
  );
}
