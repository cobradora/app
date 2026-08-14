import { db } from "@/db";
import { groups, participants, charges, checkoutSessions, checkoutItems, gatewayAccounts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { getPaymentsAdapter } from "@/payments";
import { normalizePhoneBR } from "@/lib/phone";

const SESSION_TTL_MS = 30 * 60 * 1000;

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
 * charges.totalAmount das charges selecionadas — o cliente nunca informa
 * (nem tem como alterar) o valor final.
 * RB-009: idempotencia via checkoutSessions.idempotencyKey (unique) — uma
 * segunda chamada com a mesma key reaproveita a sessao ja criada em vez de
 * duplicar a cobranca.
 *
 * Reserva atomica: uma charge so pode ser selecionada para uma NOVA sessao
 * enquanto estiver "open". O claim (UPDATE ... WHERE status = 'open') e'
 * atomico no banco, entao duas requisicoes concorrentes (abas duplicadas,
 * retry com idempotencyKey diferente) nunca conseguem reservar a mesma
 * charge em duas sessoes de checkout simultaneas — a segunda falha com erro
 * em vez de gerar dois links de pagamento validos para a mesma cobranca.
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

  const webhookToken = randomBytes(32).toString("base64url");
  const webhookTokenHash = sha256Hex(webhookToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // A sessao e salva no banco ANTES de chamar a InfinitePay (mesmo padrao do
  // portal-de-torcida em create-order.mjs), para que o id gerado pelo banco
  // sirva de order_nsu determinístico. O claim das charges e a criacao da
  // sessao/itens acontecem na mesma transacao — se o claim nao pegar todas
  // as charges pedidas (porque outra sessao concorrente ja reservou alguma),
  // a transacao inteira e desfeita.
  const { session, claimedCharges, totalChargesAmount } = await db.transaction(async (tx) => {
    const claimedCharges = await tx
      .update(charges)
      .set({ status: "checkout_pending" })
      .where(
        and(
          inArray(charges.id, chargeIds),
          eq(charges.participantId, participant.id),
          eq(charges.status, "open"),
        ),
      )
      .returning();

    if (claimedCharges.length === 0 || claimedCharges.length !== chargeIds.length) {
      throw new Error(
        "Uma ou mais cobranças não estão mais disponíveis para pagamento (já pagas ou com um checkout em andamento)",
      );
    }

    // RB-006: soma recalculada no backend, nunca aceita do cliente.
    const totalChargesAmount = claimedCharges.reduce((sum, charge) => sum + charge.totalAmount, 0);

    const [session] = await tx
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

    await tx.insert(checkoutItems).values(
      claimedCharges.map((charge) => ({
        checkoutSessionId: session.id,
        chargeId: charge.id,
        amount: charge.totalAmount,
      })),
    );

    return { session, claimedCharges, totalChargesAmount };
  });

  try {
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
      buyerName: participant.name,
      buyerPhone: participant.phoneNormalized,
    });

    await db
      .update(checkoutSessions)
      .set({ gatewayCheckoutId, checkoutUrl })
      .where(eq(checkoutSessions.id, session.id));

    return { checkoutSessionId: session.id, checkoutUrl, totalChargesAmount };
  } catch (error) {
    // A criacao do link externo falhou: libera a reserva das charges (volta
    // para "open") em vez de deixa-las presas em "checkout_pending" para
    // sempre, e marca a sessao como cancelada.
    await db
      .update(charges)
      .set({ status: "open" })
      .where(
        inArray(
          charges.id,
          claimedCharges.map((c) => c.id),
        ),
      );
    await db.update(checkoutSessions).set({ status: "canceled" }).where(eq(checkoutSessions.id, session.id));
    throw error;
  }
}
