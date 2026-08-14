import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type CheckoutTokenPurpose = "webhook" | "recovery";

function getTokenSecret(): string {
  const secret = process.env.PAYMENT_TOKEN_SECRET ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("PAYMENT_TOKEN_SECRET/SESSION_SECRET ausente ou curto demais (mínimo 32 caracteres)");
  }
  return secret;
}

/**
 * Token determinístico por sessão. Isso permite reconstruir os segredos de
 * sessões ainda não enviadas (ou revividas após rejeição definitiva) sem
 * persistir texto claro. Falhas externas ambíguas nunca são reenviadas.
 */
export function deriveCheckoutToken(sessionId: string, purpose: CheckoutTokenPurpose): string {
  return createHmac("sha256", getTokenSecret())
    .update(`cobradora:checkout:${purpose}:${sessionId}`)
    .digest("base64url");
}

export function hashCheckoutToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function matchesCheckoutToken(token: string | null | undefined, expectedHash: string | null | undefined): boolean {
  if (!token || !expectedHash || !/^[0-9a-f]{64}$/i.test(expectedHash)) return false;

  const expected = Buffer.from(expectedHash, "hex");
  const received = Buffer.from(hashCheckoutToken(token), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
