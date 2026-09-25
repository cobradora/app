import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, billingPeriods, charges, checkoutItems, checkoutSessions, financialContacts, gatewayDeposits, groups, organizationBalances, organizations, participants, payerGatewayProfiles, paymentAllocations, payments } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { isXGateEnabledForOrganization } from "@/payments/gateway-policy";
import { getXGateClient, XGateError } from "@/payments/xgate-client";
import { assertDepositEvidence, isPaidDeposit, normalizeBrazilianDocument } from "@/payments/xgate-validation";
import { deriveCheckoutToken, hashCheckoutToken, matchesCheckoutToken } from "@/payments/session-tokens";
import { calculatePaymentAmounts, creditConfirmedDeposit } from "./organization-ledger";
import { enqueueOrganizerListUpdates } from "./whatsapp-notifications";

export class XGateDepositError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
export const xgateCheckoutInput = z.object({
  phone: z.string().min(8).max(30),
  name: z.string().trim().min(2).max(200),
  document: z.string().max(25).transform((value, context) => {
    try { return normalizeBrazilianDocument(value); }
    catch { context.addIssue({ code: "custom", message: "CPF/CNPJ inválido" }); return z.NEVER; }
  }),
  email: z.string().email().max(255).optional(),
  chargeIds: z.array(z.string().uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length),
  idempotencyKey: z.string().min(10).max(100).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

const unavailable = () => new XGateDepositError("charges_unavailable", "Cobranças indisponíveis. Atualize a lista ou fale com o organizador.");

/** Reserve all charge rows before any external request. No provider fallback on uncertainty. */
export async function createXGateCheckout(publicSlug: string, rawInput: z.input<typeof xgateCheckoutInput>) {
  const input = xgateCheckoutInput.parse(rawInput);
  let phone: string;
  try { phone = normalizePhone(input.phone); } catch { throw unavailable(); }
  const ids = [...input.chargeIds].sort();
  const [group] = await db.select().from(groups).where(and(eq(groups.publicSlug, publicSlug), eq(groups.status, "active")));
  if (!group) throw new XGateDepositError("not_found", "Grupo não encontrado.", 404);
  if (!(await isXGateEnabledForOrganization(group.organizationId))) throw new XGateDepositError("gateway_unavailable", "Pix indisponível para esta organização.", 409);
  const fingerprint = createHash("sha256").update(JSON.stringify([group.id, phone, ids, input.document, input.name])).digest("hex");

  const reserved = await db.transaction(async tx => {
    const [organization] = await tx.select().from(organizations).where(and(eq(organizations.id, group.organizationId), eq(organizations.status, "active"))).for("update");
    if (!organization) throw unavailable();
    const [contact] = await tx.select().from(financialContacts).where(and(eq(financialContacts.organizationId, organization.id), eq(financialContacts.phoneNormalized, phone)));
    if (!contact) throw unavailable();
    const members = await tx.select().from(participants).where(and(eq(participants.organizationId, organization.id), eq(participants.financialContactId, contact.id))).orderBy(participants.id).for("share");
    const responsible = members.find(member => member.financialRole === "responsible");
    if (!responsible) throw unavailable();
    const [existing] = await tx.select().from(checkoutSessions).where(and(eq(checkoutSessions.organizationId, organization.id), eq(checkoutSessions.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.gateway !== "xgate" || existing.requestFingerprint !== fingerprint || existing.financialContactId !== contact.id) throw new XGateDepositError("idempotency_conflict", "Esta tentativa pertence a outra seleção.");
      const [deposit] = await tx.select().from(gatewayDeposits).where(eq(gatewayDeposits.checkoutSessionId, existing.id));
      if (!deposit) throw unavailable();
      return { session: existing, deposit, created: false };
    }
    // Recover the same payable selection after a lost response/reload, even when
    // the browser no longer has its original idempotency key.
    const [recoverable] = await tx.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.organizationId, organization.id), eq(checkoutSessions.gateway, "xgate"),
      eq(checkoutSessions.financialContactId, contact.id), eq(checkoutSessions.requestFingerprint, fingerprint),
      inArray(checkoutSessions.status, ["created", "pending", "expired"]),
    ));
    if (recoverable) {
      const [deposit] = await tx.select().from(gatewayDeposits).where(eq(gatewayDeposits.checkoutSessionId, recoverable.id));
      if (!deposit || deposit.status === "failed" || deposit.status === "refunded") throw unavailable();
      return { session: recoverable, deposit, created: false };
    }
    const selected = await tx.select({ charge: charges, groupId: billingPeriods.groupId }).from(charges)
      .innerJoin(billingPeriods, eq(charges.billingPeriodId, billingPeriods.id)).where(inArray(charges.id, ids)).orderBy(charges.id).for("update", { of: charges });
    if (selected.length !== ids.length || selected.some(row => row.groupId !== group.id || row.charge.status !== "open" || !members.some(member => member.id === row.charge.participantId))) throw unavailable();
    const overlapping = await tx.select({ id: checkoutSessions.id }).from(checkoutItems)
      .innerJoin(checkoutSessions, eq(checkoutItems.checkoutSessionId, checkoutSessions.id))
      .where(and(inArray(checkoutItems.chargeId, ids), inArray(checkoutSessions.status, ["created", "pending", "expired"])));
    if (overlapping.length) throw new XGateDepositError("reconciliation_required", "Há uma tentativa anterior em conciliação. Não gere outro pagamento.");
    const amounts = calculatePaymentAmounts(selected.reduce((sum, row) => sum + row.charge.totalAmount, 0));
    if (amounts.grossAmount < 20) throw new XGateDepositError("amount_too_small", "O valor mínimo do Pix é R$ 0,20.", 400);
    const [profile] = await tx.select().from(payerGatewayProfiles).where(and(eq(payerGatewayProfiles.organizationId, organization.id), eq(payerGatewayProfiles.financialContactId, contact.id), eq(payerGatewayProfiles.provider, "xgate")));
    if (profile && profile.document !== input.document) throw new XGateDepositError("payer_mismatch", "Os dados do pagador precisam ser conferidos com o organizador.");
    if (!profile) await tx.insert(payerGatewayProfiles).values({ organizationId: organization.id, financialContactId: contact.id, name: input.name, document: input.document, phone, email: input.email });
    const [session] = await tx.insert(checkoutSessions).values({
      organizationId: organization.id, participantId: responsible.id, financialContactId: contact.id,
      gateway: "xgate", idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
      expiresAt: new Date(Date.now() + 15 * 60000),
    }).returning();
    await tx.update(checkoutSessions).set({ recoveryTokenHash: hashCheckoutToken(deriveCheckoutToken(session.id, "recovery")) }).where(eq(checkoutSessions.id, session.id));
    await tx.insert(checkoutItems).values(selected.map(row => ({ checkoutSessionId: session.id, chargeId: row.charge.id, amount: row.charge.totalAmount })));
    const claimed = await tx.update(charges).set({ status: "checkout_pending", updatedAt: new Date() }).where(and(inArray(charges.id, ids), eq(charges.status, "open"))).returning({ id: charges.id });
    if (claimed.length !== ids.length) throw unavailable();
    const [deposit] = await tx.insert(gatewayDeposits).values({ organizationId: organization.id, financialContactId: contact.id, checkoutSessionId: session.id, ...amounts }).returning();
    return { session, deposit, created: true };
  });
  const { session, deposit } = reserved;
  const checkoutUrl = `/pagamento/pix/${deposit.id}#${deriveCheckoutToken(session.id, "recovery")}`;
  // A repeat may claim a request that never started (crash after reservation).
  // Once in_flight/ambiguous/linked, only reconciliation may advance it.
  const [claimed] = await db.update(gatewayDeposits).set({ externalCreationState: "in_flight", externalRequestStartedAt: new Date() })
    .where(and(eq(gatewayDeposits.id, deposit.id), eq(gatewayDeposits.externalCreationState, "not_started"))).returning();
  if (!claimed) return { depositId: deposit.id, checkoutUrl };
  let submitted = false;
  try {
    const client = getXGateClient();
    const currency = await client.getBrlCurrency("deposit");
    const [profile] = await db.select().from(payerGatewayProfiles).where(and(eq(payerGatewayProfiles.organizationId, deposit.organizationId), eq(payerGatewayProfiles.financialContactId, deposit.financialContactId), eq(payerGatewayProfiles.provider, "xgate")));
    const customerId = profile?.providerCustomerId ?? (await client.createCustomer({ name: input.name, document: input.document, email: input.email, phone })).customer._id;
    const identity = await client.getCustomer(customerId);
    if (identity._id !== customerId || !identity.document || normalizeBrazilianDocument(identity.document) !== input.document) throw new XGateDepositError("payer_mismatch", "Não foi possível conferir o documento do pagador.");
    await db.transaction(async tx => {
      await tx.update(payerGatewayProfiles).set({ providerCustomerId: identity._id, status: "active", updatedAt: new Date() }).where(and(eq(payerGatewayProfiles.organizationId, deposit.organizationId), eq(payerGatewayProfiles.financialContactId, deposit.financialContactId), eq(payerGatewayProfiles.provider, "xgate"), eq(payerGatewayProfiles.document, input.document)));
      await tx.update(checkoutSessions).set({ gatewayExternalAccountIdSnapshot: identity._id, externalCreationState: "in_flight", externalRequestStartedAt: new Date() }).where(eq(checkoutSessions.id, session.id));
    });
    submitted = true;
    const result = await client.createDeposit({ amountCents: deposit.grossAmount, customerId: identity._id, externalId: deposit.id, currency });
    if (result.data.customerId !== identity._id) throw new Error("XGate identity mismatch");
    await db.transaction(async tx => {
      // Webhook may already have reconciled the transaction. Do not regress it.
      await tx.update(checkoutSessions).set({ gatewayCheckoutId: result.data.id, checkoutUrl: `/pagamento/pix/${deposit.id}`, externalCreationState: "linked", status: "pending" }).where(and(eq(checkoutSessions.id, session.id), eq(checkoutSessions.status, "created")));
      await tx.update(gatewayDeposits).set({ providerTransactionId: result.data.id, pixCopyPaste: result.data.code, externalCreationState: "linked", status: "pending", updatedAt: new Date() }).where(and(eq(gatewayDeposits.id, deposit.id), eq(gatewayDeposits.status, "created")));
    });
  } catch (error) {
    const definitive = !submitted || (error instanceof XGateError && error.outcome === "rejected");
    await db.transaction(async tx => {
      const [current] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, session.id)).for("update");
      if (!current || current.status === "completed") return;
      if (definitive) {
        await tx.update(gatewayDeposits).set({ status: "failed", updatedAt: new Date() }).where(eq(gatewayDeposits.id, deposit.id));
        await tx.update(checkoutSessions).set({ status: "canceled" }).where(eq(checkoutSessions.id, session.id));
        await tx.update(charges).set({ status: "open", updatedAt: new Date() }).where(and(inArray(charges.id, ids), eq(charges.status, "checkout_pending")));
      } else {
        await tx.update(gatewayDeposits).set({ externalCreationState: "ambiguous", updatedAt: new Date() }).where(eq(gatewayDeposits.id, deposit.id));
        await tx.update(checkoutSessions).set({ externalCreationState: "ambiguous" }).where(eq(checkoutSessions.id, session.id));
      }
    });
  }
  return { depositId: deposit.id, checkoutUrl };
}

async function loadDeposit(depositId: string) {
  const [record] = await db.select({ deposit: gatewayDeposits, session: checkoutSessions }).from(gatewayDeposits)
    .innerJoin(checkoutSessions, eq(gatewayDeposits.checkoutSessionId, checkoutSessions.id))
    .where(and(eq(gatewayDeposits.id, depositId), eq(gatewayDeposits.provider, "xgate"), eq(checkoutSessions.gateway, "xgate"), eq(gatewayDeposits.organizationId, checkoutSessions.organizationId)));
  if (!record) throw new XGateDepositError("not_found", "Pagamento não encontrado.", 404);
  return record;
}

/** Hint is untrusted. Missing creation response requires externalId from the authenticated query. */
export async function reconcileXGateDeposit(depositId: string, transactionHint?: string) {
  const { deposit, session } = await loadDeposit(depositId);
  if (deposit.status === "refunded" || deposit.status === "failed") return;
  const transactionId = deposit.providerTransactionId ?? transactionHint;
  if (!transactionId || !session.gatewayExternalAccountIdSnapshot) return;
  const details = await getXGateClient().getDeposit(transactionId);
  assertDepositEvidence(details, { transactionId, externalId: deposit.id, customerId: session.gatewayExternalAccountIdSnapshot, amount: deposit.grossAmount, requireExternalId: !deposit.providerTransactionId });
  if (!isPaidDeposit(details)) {
    // Do not acknowledge a later reversal/dispute as reconciled. Its financial
    // meaning needs the provider's terminal-status contract before compensation.
    if (deposit.status === "confirmed") {
      await db.transaction(async tx => {
        await tx.select().from(organizationBalances).where(eq(organizationBalances.organizationId, deposit.organizationId)).for("update");
        const [review] = await tx.select({ action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.organizationId, deposit.organizationId), eq(auditEvents.entityId, deposit.id), inArray(auditEvents.action, ["xgate_deposit_review", "xgate_deposit_review_resolved"]))).orderBy(desc(auditEvents.createdAt)).limit(1);
        if (review?.action !== "xgate_deposit_review") await tx.insert(auditEvents).values({ organizationId: deposit.organizationId, entityType: "gateway_deposit", entityId: deposit.id, actorType: "system", action: "xgate_deposit_review", createdAt: new Date(), metadata: { providerTransactionId: transactionId, providerStatus: details.currency.status, netAmount: deposit.netAmount } });
      });
      throw new XGateDepositError("post_payment_review", "Alteração posterior ao pagamento requer conciliação.");
    }
    return; // Unknown/failure status never releases a possibly payable Pix.
  }
  if (deposit.status === "confirmed") return;
  await db.transaction(async tx => {
    // Same lock order as the ledger: balance, session, deposit, charges.
    await tx.insert(organizationBalances).values({ organizationId: deposit.organizationId }).onConflictDoNothing();
    await tx.select().from(organizationBalances).where(eq(organizationBalances.organizationId, deposit.organizationId)).for("update");
    const [currentSession] = await tx.select().from(checkoutSessions).where(eq(checkoutSessions.id, session.id)).for("update");
    const [current] = await tx.select().from(gatewayDeposits).where(eq(gatewayDeposits.id, deposit.id)).for("update");
    if (!current || !currentSession) throw unavailable();
    if (current.status === "confirmed" || current.status === "refunded") return;
    if (current.status === "failed" || currentSession.status === "canceled" || (current.providerTransactionId && current.providerTransactionId !== transactionId)) throw unavailable();
    const items = await tx.select().from(checkoutItems).where(eq(checkoutItems.checkoutSessionId, session.id));
    if (!items.length || items.reduce((sum, item) => sum + item.amount, 0) !== deposit.grossAmount) throw unavailable();
    const updated = await tx.update(charges).set({ status: "paid", updatedAt: new Date() }).where(and(inArray(charges.id, items.map(item => item.chargeId)), eq(charges.status, "checkout_pending"))).returning();
    if (updated.length !== items.length) throw unavailable();
    const [payment] = await tx.insert(payments).values({ organizationId: deposit.organizationId, participantId: session.participantId, gateway: "xgate", gatewayPaymentId: `xgate:${transactionId}`, amount: deposit.grossAmount, status: "confirmed", paidAt: new Date(), paymentMethod: "pix" }).returning();
    await tx.insert(paymentAllocations).values(items.map(item => ({ paymentId: payment.id, chargeId: item.chargeId, amount: item.amount })));
    await tx.update(gatewayDeposits).set({ providerTransactionId: transactionId, externalCreationState: "linked" }).where(eq(gatewayDeposits.id, deposit.id));
    await creditConfirmedDeposit({ organizationId: deposit.organizationId, depositId: deposit.id }, tx);
    // Same transaction as the payment: either payment and outbox both commit, or neither does.
    // Replayed webhooks exit above; the outbox also has a unique payment/period key.
    const paidCharges = await tx.select({ billingPeriodId: charges.billingPeriodId }).from(charges).where(inArray(charges.id, items.map(item => item.chargeId)));
    await enqueueOrganizerListUpdates(tx, {
      organizationId: deposit.organizationId,
      paymentId: payment.id,
      billingPeriodIds: paidCharges.map(charge => charge.billingPeriodId),
    });
    await tx.update(checkoutSessions).set({ status: "completed", externalCreationState: "linked", gatewayCheckoutId: transactionId, gatewayPaymentId: `xgate:${transactionId}` }).where(eq(checkoutSessions.id, session.id));
    await tx.insert(auditEvents).values({ organizationId: deposit.organizationId, entityType: "payment", entityId: payment.id, actorType: "system", action: "xgate_deposit_confirmed", metadata: { depositId: deposit.id, grossAmount: deposit.grossAmount, feeAmount: deposit.feeAmount, netAmount: deposit.netAmount } });
  });
}

export async function getPublicXGateDeposit(depositId: string, token: string, reconcile = false) {
  const initial = await loadDeposit(depositId);
  if (!matchesCheckoutToken(token, initial.session.recoveryTokenHash)) throw new XGateDepositError("not_found", "Pagamento não encontrado.", 404);
  let reconciliationUnavailable = false;
  if (reconcile && initial.deposit.status !== "confirmed" && initial.deposit.status !== "refunded" && initial.deposit.status !== "failed") {
    try { await reconcileXGateDeposit(depositId); }
    catch { reconciliationUnavailable = true; }
  }
  const { deposit } = await loadDeposit(depositId);
  return { id: deposit.id, amount: deposit.grossAmount, status: deposit.status, pixCopyPaste: deposit.status === "pending" ? deposit.pixCopyPaste : null, reconciliationRequired: deposit.externalCreationState === "ambiguous" || (deposit.status === "created" && Date.now() - deposit.createdAt.getTime() > 60000), reconciliationUnavailable };
}
