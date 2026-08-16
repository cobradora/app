import { SignJWT, jwtVerify } from "jose";

const RESET_TOKEN_TTL = "30m";
const RESET_TOKEN_PURPOSE = "password_reset";

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET ausente ou curto demais (mínimo 32 caracteres)");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Token separado do cookie de sessão (mesmo segredo, claim de propósito
 * próprio) — nunca pode ser aceito como sessão nem vice-versa, e expira em
 * minutos em vez de dias. Sem tabela no banco: stateless, como a sessão.
 */
export async function createPasswordResetToken(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: RESET_TOKEN_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(RESET_TOKEN_TTL)
    .sign(getSecretKey());
}

export async function verifyPasswordResetToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, getSecretKey());
  if (payload.purpose !== RESET_TOKEN_PURPOSE || typeof payload.userId !== "string") {
    throw new Error("Token de recuperação inválido");
  }
  return payload.userId;
}
