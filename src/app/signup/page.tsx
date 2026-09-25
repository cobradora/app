"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CreditCard, Eye, EyeOff, Sparkles } from "lucide-react";
import { apiClient, type BillingModule } from "@/lib/api-client";
import { Spinner } from "@/components/spinner";
import cobraLogo from "@/images/logo-cobra-sem-fundo.png";
import { formatPhoneInput, isValidPhone, PHONE_INPUT_MAX_LENGTH } from "@/lib/phone";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [billingModule, setBillingModule] = useState<BillingModule>(
    searchParams.get("module") === "cobradora" ? "cobradora" : "dora",
  );
  const [organizerPhone, setOrganizerPhone] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("A confirmação não bate com a senha.");
      return;
    }
    if (billingModule === "cobradora" && !isValidPhone(organizerPhone)) {
      setError("Informe um telefone válido. Para outros países, use o código do país, como +351.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.signup({
        organizationName,
        name,
        email,
        password,
        billingModule,
        organizerPhone: billingModule === "cobradora" ? organizerPhone : null,
      });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(
    organizationName.trim() &&
      name.trim() &&
      email.trim() &&
      password.trim().length >= 8 &&
      confirmPassword.trim().length >= 8 &&
      acceptedTerms &&
      (billingModule === "dora" || isValidPhone(organizerPhone)),
  );

  return (
    <div className="auth-page auth-page--signup">
      <div className="auth-orb auth-orb--one" />
      <div className="auth-orb auth-orb--two" />
      <main className="auth-card auth-card--wide auth-card--modules">
        <Link className="auth-brand" href="/" aria-label="CobraDora — início">
          <Image src={cobraLogo} alt="" width={74} height={74} priority />
          <span><strong>CobraDora</strong><small>Assistente de Cobranças</small></span>
        </Link>

        <div className="auth-heading">
          <span className="auth-chip"><Sparkles size={15} /> Comece agora</span>
          <h1>Escolha como quer cobrar</h1>
          <p>Você pode começar grátis com a Grátis ou automatizar a rotina com a Premium.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <fieldset className="module-choice" aria-describedby="module-choice-hint">
            <legend>Seu módulo de cobrança</legend>
            <p id="module-choice-hint">Você poderá revisar essa escolha nas Configurações.</p>
            <div className="module-choice__grid">
              <label className={`module-option ${billingModule === "dora" ? "module-option--selected" : ""}`}>
                <input
                  type="radio"
                  name="billing-module"
                  value="dora"
                  checked={billingModule === "dora"}
                  onChange={() => { setBillingModule("dora"); setError(null); }}
                />
                <span className="module-option__top"><strong>Grátis</strong><b>R$ 0</b></span>
                <small>Você acompanha os pagamentos no painel e copia ou compartilha a lista atualizada.</small>
              </label>
              <label className={`module-option ${billingModule === "cobradora" ? "module-option--selected" : ""}`}>
                <input
                  type="radio"
                  name="billing-module"
                  value="cobradora"
                  checked={billingModule === "cobradora"}
                  onChange={() => { setBillingModule("cobradora"); setError(null); }}
                />
                <span className="module-option__top"><strong>Premium</strong><b>Automação</b></span>
                <small>Mensalistas recebem a cobrança no privado e você recebe a lista atualizada.</small>
              </label>
            </div>
          </fieldset>

          {billingModule === "cobradora" && (
            <div className="auth-conditional-field">
              <label htmlFor="organizerPhone">WhatsApp do organizador</label>
              <div className="auth-input">
                <input
                  id="organizerPhone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={PHONE_INPUT_MAX_LENGTH}
                  value={organizerPhone}
                  onChange={(event) => setOrganizerPhone(formatPhoneInput(event.target.value))}
                  placeholder="(11) 99999-9999 ou +351…"
                  required
                  aria-describedby="organizer-phone-hint"
                />
              </div>
              <p id="organizer-phone-hint" className="field-hint">Para outros países, comece com + e o código do país. É neste número que a CobraDora enviará as listas.</p>
            </div>
          )}

          <div className="auth-required-note" role="note">
            <CreditCard size={19} aria-hidden="true" />
            <p>
              <strong>No Grátis, os pagamentos usam a InfinitePay.</strong> Conecte sua InfiniteTag para receber direto na sua conta.{" "}
              <a href="https://www.infinitepay.io/conta" target="_blank" rel="noopener noreferrer">Abrir conta InfinitePay</a>.{" "}
              <strong>No Premium, os recebimentos Pix usam a XGate.</strong> Depois do cadastro, complete seus dados em{" "}
              <Link href="/financeiro">Saldo e recebimentos Pix</Link>. A taxa da plataforma é de 3% sobre cada pagamento confirmado, sem nova taxa de plataforma no saque.
            </p>
          </div>

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

          <label className="auth-consent auth-consent--checkbox">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              required
            />
            <span>
              Li e concordo com os{" "}
              <Link className="link" href="/termos-de-uso" target="_blank" rel="noopener noreferrer">
                Termos de Uso
              </Link>{" "}
              e com a{" "}
              <Link className="link" href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">
                Política de Privacidade
              </Link>
              .
            </span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="button button--primary button--full auth-submit" disabled={submitting || !canSubmit}>
            {submitting ? <><Spinner size={18} /><span>Criando…</span></> : <><span>{billingModule === "dora" ? "Criar conta Grátis" : "Continuar com Premium"}</span><ArrowRight size={18} /></>}
          </button>
        </form>

        <p className="auth-switch">
          Já tem uma conta? <Link href="/login">Entrar</Link>
        </p>
      </main>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="auth-page"><Spinner size={24} /></div>}>
      <SignupForm />
    </Suspense>
  );
}
