import { SignJWT, jwtVerify } from "jose";

export type SessionPayload = {
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
};

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET ausente ou curto demais (mínimo 32 caracteres)");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getSecretKey());
  return payload as unknown as SessionPayload;
}
