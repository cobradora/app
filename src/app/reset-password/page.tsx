"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("A confirmação não bate com a senha.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.resetPassword({ token, newPassword });
      router.push("/login");
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (!token) {
    return <p className="form-error" role="alert">Link inválido. Peça um novo link em &quot;Esqueci minha senha&quot;.</p>;
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="newPassword">Nova senha</label>
      <div className="auth-input">
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="Mínimo de 8 caracteres"
          required
        />
      </div>

      <label htmlFor="confirmPassword">Confirmar senha</label>
      <div className="auth-input">
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          minLength={8}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Repita a senha"
          required
        />
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button type="submit" className="button button--primary button--full auth-submit" disabled={submitting || newPassword.trim().length < 8 || confirmPassword.trim().length < 8}>
        {submitting ? "Salvando…" : <><span>Redefinir senha</span><ArrowRight size={18} /></>}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
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
          <span className="auth-chip"><CheckCircle2 size={15} /> Nova senha</span>
          <h1>Crie uma nova senha</h1>
          <p>O link expira em 30 minutos após ser gerado.</p>
        </div>

        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>

        <p className="auth-switch">
          Lembrou a senha? <Link href="/login">Entrar</Link>
        </p>
      </main>
    </div>
  );
}
