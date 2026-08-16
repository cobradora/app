"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Spinner } from "@/components/spinner";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";

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
    <div className="auth-page">
      <div className="auth-orb auth-orb--one" />
      <div className="auth-orb auth-orb--two" />
      <main className="auth-card">
        <Link className="auth-brand" href="/" aria-label="CobraDora — início">
          <Image src={cobraLogo} alt="" width={74} height={74} priority />
          <span><strong>CobraDora</strong><small>Assistente de Cobranças</small></span>
        </Link>

        <div className="auth-heading">
          <span className="auth-chip"><CheckCircle2 size={15} /> Área segura</span>
          <h1>Que bom ter você de volta</h1>
          <p>Entre para acompanhar seus grupos e pagamentos.</p>
        </div>

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

          <div className="auth-label-row">
            <label htmlFor="password">Senha</label>
            <Link className="auth-inline-link" href="/forgot-password">Esqueci minha senha</Link>
          </div>
          <div className="auth-input">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Sua senha"
              required
            />
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="button button--primary button--full auth-submit" disabled={submitting || !email.trim() || !password.trim()}>
            {submitting ? <><Spinner size={18} /><span>Entrando…</span></> : <><span>Entrar</span><ArrowRight size={18} /></>}
          </button>
        </form>

        <p className="auth-switch">
          Ainda não usa a CobraDora? <Link href="/signup">Criar conta</Link>
        </p>
      </main>
    </div>
  );
}
