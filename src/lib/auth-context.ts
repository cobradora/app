import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession, type SessionPayload } from "@/lib/session";

export class UnauthorizedError extends Error {}

export async function requireOrganization(): Promise<SessionPayload> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new UnauthorizedError("Sessão ausente");

  try {
    return await verifySession(token);
  } catch {
    throw new UnauthorizedError("Sessão inválida ou expirada");
  }
}
