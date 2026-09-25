import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet, Lock, Banknote, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { requireOwnerOrAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth-context";
import { getOrganizationBalance, isOrganizationBalanceUnderReview } from "@/services/organization-ledger";
import { db } from "@/db";
import { gatewayDeposits, groups, organizationPayoutProfiles, withdrawals } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getXGateOrganizationAvailability } from "@/payments/gateway-policy";
import { FinancePayoutProfileForm } from "@/components/finance-payout-profile-form";
import { FinanceWithdrawalForm } from "@/components/finance-withdrawal-form";
export const dynamic = "force-dynamic";
const money = (amount: number) => (amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pillClass = (status: string, active: string[], danger: string[]) =>
  active.includes(status) ? "status-pill status-pill--active" : danger.includes(status) ? "status-pill status-pill--danger" : "status-pill";

export default async function FinancePage() {
  const session = await requireOwnerOrAdmin().catch(error => {
    if (error instanceof UnauthorizedError) redirect("/login");
    if (error instanceof ForbiddenError) redirect("/");
    throw error;
  });
  const balance = await getOrganizationBalance(session.organizationId);
  const underReview = await isOrganizationBalanceUnderReview(session.organizationId);
  const deposits = await db.select().from(gatewayDeposits).where(eq(gatewayDeposits.organizationId, session.organizationId)).orderBy(desc(gatewayDeposits.createdAt)).limit(30);
  const [payoutProfile] = await db.select().from(organizationPayoutProfiles).where(eq(organizationPayoutProfiles.organizationId, session.organizationId));
  const withdrawalHistory = await db.select().from(withdrawals).where(eq(withdrawals.organizationId, session.organizationId)).orderBy(desc(withdrawals.createdAt)).limit(30);
  const xgateAvailability = await getXGateOrganizationAvailability(session.organizationId);
  const xgateEnabled = xgateAvailability.enabled;
  const activeGroups = xgateEnabled ? await db.select({ id: groups.id, name: groups.name, publicSlug: groups.publicSlug }).from(groups).where(and(eq(groups.organizationId, session.organizationId), eq(groups.status, "active"))) : [];
  const labels: Record<string, string> = { created: "Preparando", pending: "Aguardando pagamento", confirmed: "Confirmado", failed: "Não gerado", refunded: "Estornado" };
  const withdrawalLabels: Record<string, string> = { created: "Preparando", reserved: "Reservado", pending: "Processando", completed: "Concluído", failed: "Não realizado" };
  return <main className="auth-page"><section className="auth-card auth-card--wide" style={{ maxWidth: 1000 }}>
    <Link href="/" className="link">← Voltar ao painel</Link><h1>Saldo da organização</h1>
    <p>A taxa da plataforma é de 3% sobre cada pagamento Pix confirmado. O saldo já apresenta o valor líquido, sem nova taxa de plataforma no saque.</p>

    <section className="summary-grid">
      <article className="summary-card summary-card--received">
        <span className="summary-card__icon"><Wallet size={21} /></span>
        <div><p>Saldo líquido</p><strong>{money(balance.settledAmount)}</strong></div>
      </article>
      <article className="summary-card summary-card--pending">
        <span className="summary-card__icon"><Lock size={21} /></span>
        <div><p>Reservado</p><strong>{money(balance.reservedAmount)}</strong></div>
      </article>
      <article className="summary-card summary-card--expected">
        <span className="summary-card__icon"><Banknote size={21} /></span>
        <div><p>Disponível</p><strong>{money(balance.availableAmount)}</strong></div>
      </article>
    </section>

    <p>Recebimentos pela InfinitePay e baixas manuais não compõem este saldo.</p>
    {underReview && <p role="alert">Saldo temporariamente indisponível: um recebimento teve alteração posterior à confirmação e precisa de conciliação. Fale com o suporte.</p>}
    {activeGroups.length > 0 && <><h2>Links de pagamento Pix</h2><ul>{activeGroups.map(group => <li key={group.id}><Link href={`/g/${group.publicSlug}/pix`}>{group.name}</Link></li>)}</ul></>}

    <h2>Últimos depósitos</h2>
    {!deposits.length ? <p>Nenhum depósito registrado.</p> : <ul className="pending-list">{deposits.map(deposit => <li key={deposit.id} className="pending-row">
      <span className="person-avatar"><ArrowDownCircle size={18} /></span>
      <div className="pending-row__person">
        <strong>{deposit.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</strong>
        <span>Bruto {money(deposit.grossAmount)} · Taxa {money(deposit.feeAmount)}</span>
      </div>
      <span className={pillClass(deposit.status, ["confirmed"], ["failed"])}>{labels[deposit.status] ?? "Em conciliação"}</span>
      <span className="pending-row__amount">{money(deposit.netAmount)}</span>
    </li>)}</ul>}
    <p>Valores pendentes só entram no saldo após confirmação.</p>

    <h2>Chave Pix de recebimento</h2>
    {xgateEnabled ? <FinancePayoutProfileForm profile={payoutProfile ? { name: payoutProfile.name, pixKeyType: payoutProfile.pixKeyType as "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM", pixKey: payoutProfile.pixKey, status: payoutProfile.status } : null} /> : <p role="status">{xgateAvailability.message}</p>}

    <h2>Saque</h2>
    <FinanceWithdrawalForm
      availableAmount={balance.availableAmount}
      disabled={!xgateEnabled || underReview || payoutProfile?.status !== "active"}
      disabledReason={!xgateEnabled ? xgateAvailability.message ?? "Saque temporariamente indisponível." : underReview ? "Saldo em conciliação: saque temporariamente indisponível." : payoutProfile?.status !== "active" ? "Cadastre a chave Pix de recebimento acima para poder solicitar saques." : undefined}
    />

    <h2>Últimos saques</h2>
    {!withdrawalHistory.length ? <p>Nenhum saque solicitado.</p> : <ul className="pending-list">{withdrawalHistory.map(withdrawal => <li key={withdrawal.id} className="pending-row">
      <span className="person-avatar"><ArrowUpCircle size={18} /></span>
      <div className="pending-row__person">
        <strong>{withdrawal.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</strong>
        <span>Saque Pix</span>
      </div>
      <span className={pillClass(withdrawal.status, ["completed"], ["failed"])}>{withdrawalLabels[withdrawal.status] ?? "Em conciliação"}</span>
      <span className="pending-row__amount">{money(withdrawal.amount)}</span>
    </li>)}</ul>}

    <Link href="/financeiro" prefetch={false}>Atualizar saldo</Link>
  </section></main>;
}
