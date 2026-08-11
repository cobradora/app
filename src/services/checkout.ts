import { db } from "@/db";
import { groups, participants, charges, checkoutSessions, checkoutItems, gatewayAccounts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { getPaymentsAdapter } from "@/payments";

const SESSION_TTL_MS = 30 * 60 * 1000;

function normalizePhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return `+55${withoutCountry}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cria um checkout InfinitePay para um conjunto de charges pendentes de um
 * participante de um grupo publico.
 *
 * RB-006: o valor cobrado e sempre recalculado no backend a partir de
 * charges.totalAmount das charges selecionadas (status "open" ou
 * "checkout_pending") — o cliente nunca informa (nem tem como alterar) o
 * valor final.
 * RB-009: idempotencia via checkoutSessions.idempotencyKey (unique) — uma
 * segunda chamada com a mesma key reaproveita a sessao ja criada em vez de
 * duplicar a cobranca.
 */
export async function createCheckoutForCharges(
  groupPublicSlug: string,
  rawPhone: string,
  chargeIds: string[],
  idempotencyKey: string,
) {
  const [group] = await db.select().from(groups).where(eq(groups.publicSlug, groupPublicSlug));
  if (!group) throw new Error("Grupo não encontrado");

  const phoneNormalized = normalizePhoneBR(rawPhone);
  const [participant] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.organizationId, group.organizationId), eq(participants.phoneNormalized, phoneNormalized)));
  if (!participant) throw new Error("Participante não encontrado");

  const [gatewayAccount] = await db
    .select()
    .from(gatewayAccounts)
    .where(
      and(
        eq(gatewayAccounts.organizationId, group.organizationId),
        eq(gatewayAccounts.provider, "infinitepay"),
        eq(gatewayAccounts.status, "active"),
      ),
    );
  if (!gatewayAccount) throw new Error("Conta InfinitePay não configurada para esta organização");

  // RB-009: se ja existe uma sessao para essa idempotencyKey, reaproveita-a
  // em vez de criar (e cobrar) duas vezes para o mesmo retry do cliente.
  const [existingSession] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.idempotencyKey, idempotencyKey));

  if (existingSession) {
    const existingItems = await db
      .select()
      .from(checkoutItems)
      .where(eq(checkoutItems.checkoutSessionId, existingSession.id));
    const totalChargesAmount = existingItems.reduce((sum, item) => sum + item.amount, 0);

    // checkoutUrl fica persistida na sessao — reaproveitamos o link ja
    // gerado em vez de rechamar a InfinitePay, que nao garante que um
    // order_nsu repetido devolva a mesma URL (idempotencia real, sem
    // depender do comportamento da API deles).
    if (!existingSession.checkoutUrl) {
      throw new Error("Sessão de checkout existente sem checkoutUrl — estado inconsistente");
    }

    return { checkoutSessionId: existingSession.id, checkoutUrl: existingSession.checkoutUrl, totalChargesAmount };
  }

  const selectedCharges = await db
    .select()
    .from(charges)
    .where(
      and(
        inArray(charges.id, chargeIds),
        eq(charges.participantId, participant.id),
        inArray(charges.status, ["open", "checkout_pending"]),
      ),
    );

  if (selectedCharges.length === 0) {
    throw new Error("Nenhuma cobrança pendente encontrada para os IDs informados");
  }

  // RB-006: soma recalculada no backend, nunca aceita do cliente.
  const totalChargesAmount = selectedCharges.reduce((sum, charge) => sum + charge.totalAmount, 0);

  const webhookToken = randomBytes(32).toString("base64url");
  const webhookTokenHash = sha256Hex(webhookToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // A sessao e salva no banco ANTES de chamar a InfinitePay (mesmo padrao do
  // portal-de-torcida em create-order.mjs), para que o id gerado pelo banco
  // sirva de order_nsu determinístico.
  const [session] = await db
    .insert(checkoutSessions)
    .values({
      organizationId: group.organizationId,
      participantId: participant.id,
      gateway: "infinitepay",
      status: "created",
      expiresAt,
      idempotencyKey,
      webhookTokenHash,
    })
    .returning();

  const { checkoutUrl, gatewayCheckoutId } = await getPaymentsAdapter().createCheckout({
    organizationId: group.organizationId,
    participantId: participant.id,
    amount: totalChargesAmount,
    splits: [],
    dueDate: today(),
    idempotencyKey,
    gatewayExternalAccountId: gatewayAccount.externalAccountId,
    externalReference: session.id,
    webhookToken,
  });

  await db
    .update(checkoutSessions)
    .set({ gatewayCheckoutId, checkoutUrl })
    .where(eq(checkoutSessions.id, session.id));

  await db.insert(checkoutItems).values(
    selectedCharges.map((charge) => ({
      checkoutSessionId: session.id,
      chargeId: charge.id,
      amount: charge.totalAmount,
    })),
  );

  await db
    .update(charges)
    .set({ status: "checkout_pending" })
    .where(
      inArray(
        charges.id,
        selectedCharges.map((c) => c.id),
      ),
    );

  return { checkoutSessionId: session.id, checkoutUrl, totalChargesAmount };
}
