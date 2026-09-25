import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, organizationPayoutProfiles, organizations, withdrawals } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { getXGateOrganizationAvailability, isXGateEnabledForOrganization } from "@/payments/gateway-policy";
import { getXGateClient, XGateError, type XGatePixKey } from "@/payments/xgate-client";
import { assertTransactionEvidence, isPaidTransaction, normalizeBrazilianDocument } from "@/payments/xgate-validation";
import { releaseWithdrawal, reserveWithdrawal, settleWithdrawal } from "./organization-ledger";

export class XGatePayoutError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}

const pixKeySchema = z.discriminatedUnion("pixKeyType", [
  z.object({ pixKeyType: z.literal("CPF"), pixKey: z.string().transform((value, ctx) => {
    try { const key = normalizeBrazilianDocument(value); if (key.length !== 11) throw new Error(); return key; } catch { ctx.addIssue({ code: "custom", message: "Chave Pix: informe um CPF válido com 11 dígitos ou altere o tipo da chave." }); return z.NEVER; }
  }) }),
  z.object({ pixKeyType: z.literal("CNPJ"), pixKey: z.string().transform((value, ctx) => {
    try { const key = normalizeBrazilianDocument(value); if (key.length !== 14) throw new Error(); return key; } catch { ctx.addIssue({ code: "custom", message: "Chave Pix: informe um CNPJ válido com 14 dígitos ou altere o tipo da chave." }); return z.NEVER; }
  }) }),
  z.object({ pixKeyType: z.literal("EMAIL"), pixKey: z.string().trim().email().max(255) }),
  z.object({ pixKeyType: z.literal("PHONE"), pixKey: z.string().transform((value, ctx) => {
    try { return normalizePhone(value); } catch { ctx.addIssue({ code: "custom", message: "Telefone inválido" }); return z.NEVER; }
  }) }),
  z.object({ pixKeyType: z.literal("RANDOM"), pixKey: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Chave aleatória inválida: copie a chave completa do aplicativo do banco.").toLowerCase() }),
]);

export const payoutProfileInput = z.intersection(
  z.object({ name: z.string().trim().min(2).max(200), document: z.string().max(25).transform((value, ctx) => {
    try { return normalizeBrazilianDocument(value); } catch { ctx.addIssue({ code: "custom", message: "CPF/CNPJ inválido" }); return z.NEVER; }
  }), email: z.string().email().max(255).optional(), phone: z.string().max(25).optional() }),
  pixKeySchema,
).superRefine((input, ctx) => {
  if ((input.pixKeyType === "CPF" || input.pixKeyType === "CNPJ") && input.pixKey !== input.document) {
    ctx.addIssue({ code: "custom", path: ["pixKey"], message: "A chave Pix deve corresponder ao CPF/CNPJ do titular informado no cadastro." });
  }
});

export const withdrawalRequestInput = z.object({
  amountCents: z.number().int().min(20).max(2147483647),
  idempotencyKey: z.string().min(10).max(100).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

/** Publish only a complete verified profile. Remote failures preserve the previous profile. */
export async function registerPayoutProfile(organizationId: string, rawInput: z.input<typeof payoutProfileInput>) {
  const availability = await getXGateOrganizationAvailability(organizationId);
  if (!availability.enabled) throw new XGatePayoutError("gateway_unavailable", availability.message ?? "Cadastro Pix indisponível.");
  const input = payoutProfileInput.parse(rawInput);
  const client = getXGateClient();
  const [profile] = await db.select().from(organizationPayoutProfiles).where(eq(organizationPayoutProfiles.organizationId, organizationId));
  let customerId = profile?.document === input.document ? profile.providerCustomerId : null;
  if (!customerId) customerId = (await client.createCustomer({ name: input.name, document: input.document, email: input.email, phone: input.phone })).customer._id;
  // A newly created customer may actually be an existing customer returned by the provider.
  const identity = await client.getCustomer(customerId);
  let identityMatches = false;
  try { identityMatches = identity._id === customerId && !!identity.document && normalizeBrazilianDocument(identity.document) === input.document; } catch { /* fail closed */ }
  if (!identityMatches) throw new XGatePayoutError("beneficiary_mismatch", "Não foi possível confirmar o CPF/CNPJ do titular na XGate. Fale com o suporte.");
  const matchesKey = (key: XGatePixKey) => {
    const parsed = pixKeySchema.safeParse({ pixKeyType: key.type, pixKey: key.key });
    return parsed.success && parsed.data.pixKeyType === input.pixKeyType && parsed.data.pixKey === input.pixKey;
  };
  let pixKey = (await client.listPixKeys(customerId)).find(matchesKey);
  if (!pixKey) {
    try { pixKey = (await client.addPixKey(customerId, { key: input.pixKey, type: input.pixKeyType })).key; }
    catch (error) {
      // Recover a lost response or concurrent registration by reading, without repeating the POST.
      try { pixKey = (await client.listPixKeys(customerId)).find(matchesKey); } catch { /* preserve original error */ }
      if (!pixKey) throw error;
    }
  }
  if (!matchesKey(pixKey)) throw new XGatePayoutError("pix_key_mismatch", "A chave retornada pela XGate não corresponde à informada. O cadastro anterior foi preservado.");
  const verifiedKey = pixKey;
  await db.transaction(async (tx) => {
    // Serialize publication even for first registrations, without holding locks over network calls.
    const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).for("update");
    if (!organization) throw new XGatePayoutError("organization_missing", "Organização não encontrada.");
    const [current] = await tx.select().from(organizationPayoutProfiles).where(eq(organizationPayoutProfiles.organizationId, organizationId)).for("update");
    if (JSON.stringify(current) !== JSON.stringify(profile)) throw new XGatePayoutError("profile_changed", "O cadastro foi atualizado em outra solicitação. Atualize a página antes de tentar novamente.");
    const values = {
      name: input.name, document: input.document, email: input.email ?? null, phone: input.phone ?? null,
      pixKeyType: input.pixKeyType, pixKey: input.pixKey, providerCustomerId: customerId,
      providerPixKeyId: verifiedKey._id, providerPixKey: verifiedKey, status: "active" as const, updatedAt: new Date(),
    };
    await tx.insert(organizationPayoutProfiles).values({ organizationId, ...values }).onConflictDoUpdate({ target: organizationPayoutProfiles.organizationId, set: values });
  });
  return { status: "active" as const };
}

async function loadActiveProfile(organizationId: string) {
  const [profile] = await db.select().from(organizationPayoutProfiles).where(eq(organizationPayoutProfiles.organizationId, organizationId));
  if (!profile || profile.status !== "active" || !profile.providerCustomerId || !profile.providerPixKeyId) {
    throw new XGatePayoutError("payout_profile_required", "Cadastre a chave Pix de recebimento antes de solicitar um saque.");
  }
  return profile;
}

/** Reserve the balance before any external request. No provider fallback on uncertainty. */
export async function requestWithdrawal(organizationId: string, rawInput: z.input<typeof withdrawalRequestInput>) {
  const input = withdrawalRequestInput.parse(rawInput);
  if (!(await isXGateEnabledForOrganization(organizationId))) throw new XGatePayoutError("gateway_unavailable", "Saque indisponível para esta organização.");
  const profile = await loadActiveProfile(organizationId);

  const withdrawal = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(withdrawals).where(and(eq(withdrawals.organizationId, organizationId), eq(withdrawals.idempotencyKey, input.idempotencyKey)));
    if (existing) return existing;
    const [row] = await tx.insert(withdrawals).values({
      organizationId, amount: input.amountCents, idempotencyKey: input.idempotencyKey,
      beneficiarySnapshot: { customerId: profile.providerCustomerId, pixKeyId: profile.providerPixKeyId, pixKeyType: profile.pixKeyType, pixKey: profile.pixKey, name: profile.name, document: profile.document },
    }).returning();
    try {
      await reserveWithdrawal({ organizationId, withdrawalId: row.id }, tx);
    } catch (error) {
      if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") throw new XGatePayoutError("insufficient_balance", "Saldo disponível insuficiente para este saque.");
      if (error instanceof Error && error.message === "BALANCE_UNDER_REVIEW") throw new XGatePayoutError("balance_under_review", "Saldo temporariamente indisponível para saque. Fale com o suporte.");
      throw error;
    }
    return row;
  });

  // A repeat may claim a request that never started (crash after reservation).
  // Once in_flight/ambiguous/linked, only reconciliation may advance it.
  const [claimed] = await db.update(withdrawals).set({ externalCreationState: "in_flight", externalRequestStartedAt: new Date() })
    .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.externalCreationState, "not_started"), eq(withdrawals.status, "reserved"))).returning();
  if (!claimed) return { withdrawalId: withdrawal.id };
  let submitted = false;
  try {
    const client = getXGateClient();
    const currency = await client.getBrlCurrency("withdraw");
    const pixKey = { _id: profile.providerPixKeyId!, key: profile.pixKey, type: profile.pixKeyType } as XGatePixKey;
    submitted = true;
    const result = await client.createWithdrawal({ amountCents: withdrawal.amount, customerId: profile.providerCustomerId!, externalId: withdrawal.id, currency, pixKey });
    await db.update(withdrawals).set({ providerTransactionId: result._id, externalCreationState: "linked", status: "pending", updatedAt: new Date() })
      .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.status, "reserved")));
  } catch (error) {
    const definitive = !submitted || (error instanceof XGateError && error.outcome === "rejected");
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id)).for("update");
      if (!current || current.status !== "reserved") return;
      if (definitive) {
        await releaseWithdrawal({ organizationId, withdrawalId: withdrawal.id }, tx);
        await tx.update(withdrawals).set({ externalCreationState: "not_started", failureReason: "creation_rejected" }).where(eq(withdrawals.id, withdrawal.id));
      } else {
        await tx.update(withdrawals).set({ externalCreationState: "ambiguous", updatedAt: new Date() }).where(eq(withdrawals.id, withdrawal.id));
      }
    });
  }
  return { withdrawalId: withdrawal.id };
}

/** Hint is untrusted. Never auto-releases a reservation from here: only a synchronous,
 * definitive rejection at request time may free the reserved balance. A stuck "ambiguous"
 * withdrawal needs manual reconciliation, same limitation documented for deposits. */
export async function reconcileXGateWithdrawal(withdrawalId: string, transactionHint?: string) {
  const [withdrawal] = await db.select().from(withdrawals).where(and(eq(withdrawals.id, withdrawalId), eq(withdrawals.provider, "xgate")));
  if (!withdrawal) throw new XGatePayoutError("not_found", "Saque não encontrado.", 404);
  if (withdrawal.status === "completed" || withdrawal.status === "failed") return;
  const transactionId = withdrawal.providerTransactionId ?? transactionHint;
  if (!transactionId) return;
  const snapshot = withdrawal.beneficiarySnapshot as { customerId: string };
  const details = await getXGateClient().getWithdrawal(transactionId);
  assertTransactionEvidence(details, { transactionId, externalId: withdrawal.id, customerId: snapshot.customerId, amount: withdrawal.amount, requireExternalId: !withdrawal.providerTransactionId });
  if (!isPaidTransaction(details)) return;
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
    if (!current || current.status === "completed" || current.status === "failed") return;
    if (current.status !== "reserved" && current.status !== "pending") return;
    await tx.update(withdrawals).set({ providerTransactionId: transactionId, externalCreationState: "linked" }).where(eq(withdrawals.id, withdrawalId));
    await settleWithdrawal({ organizationId: withdrawal.organizationId, withdrawalId }, tx);
    await tx.insert(auditEvents).values({ organizationId: withdrawal.organizationId, entityType: "withdrawal", entityId: withdrawalId, actorType: "system", action: "xgate_withdrawal_confirmed", metadata: { providerTransactionId: transactionId, amount: withdrawal.amount } });
  });
}
