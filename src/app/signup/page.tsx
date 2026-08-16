"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Eye, EyeOff, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";

export default function SignupPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("A confirmação não bate com a senha.");
      return;
    }
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
    organizationName.trim() && name.trim() && email.trim() && password.trim().length >= 8 && confirmPassword.trim().length >= 8;

  return (
    <div className="auth-page auth-page--signup">
      <div className="auth-orb auth-orb--one" />
      <div className="auth-orb auth-orb--two" />
      <main className="auth-card auth-card--wide">
        <Link className="auth-brand" href="/" aria-label="CobraDora — início">
          <Image src={cobraLogo} alt="" width={74} height={74} priority />
          <span><strong>CobraDora</strong><small>Assistente de Cobranças</small></span>
        </Link>

        <div className="auth-heading">
          <span className="auth-chip"><Sparkles size={15} /> Comece agora</span>
          <h1>Organize suas cobranças</h1>
          <p>Crie sua organização e deixe a rotina dos grupos mais leve.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="organizationName">Nome da organização</label>
          <div className="auth-input">
            <input
              id="organizationName"
              type="text"
              maxLength={120}
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Arena, equipe ou projeto"
              required
              autoFocus
            />
          </div>

          <label htmlFor="name">Seu nome</label>
          <div className="auth-input">
            <input id="name" type="text" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Como podemos chamar você?" required />
          </div>

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
            />
          </div>

          <label htmlFor="password">Senha</label>
          <div className="auth-input">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Mínimo de 8 caracteres"
              required
              minLength={8}
            />
            <button type="button" className="auth-input__toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <label htmlFor="confirmPassword">Confirmar senha</label>
          <div className="auth-input">
            <input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              maxLength={128}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repita a senha"
              required
              minLength={8}
            />
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="button button--primary button--full auth-submit" disabled={submitting || !canSubmit}>
            {submitting ? "Criando…" : <><span>Criar conta</span><ArrowRight size={18} /></>}
          </button>

          <p className="auth-consent">
            Ao criar sua conta, você concorda com nossa{" "}
            <Link className="link" href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">
              Política de Privacidade
            </Link>
            .
          </p>
        </form>

        <p className="auth-switch">
          Já tem uma conta? <Link href="/login">Entrar</Link>
        </p>
      </main>
    </div>
  );
}
