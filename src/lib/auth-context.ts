import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { SESSION_COOKIE_NAME, verifySession, type SessionPayload } from "@/lib/session";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

export async function requireOrganization(): Promise<SessionPayload> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new UnauthorizedError("Sessão ausente");

  let payload: SessionPayload;
  try {
    payload = await verifySession(token);
  } catch {
    throw new UnauthorizedError("Sessão inválida ou expirada");
  }

  const [current] = await db
    .select({
      userId: users.id,
      organizationId: users.organizationId,
      role: users.role,
    })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(
      and(
        eq(users.id, payload.userId),
        eq(users.organizationId, payload.organizationId),
        eq(users.status, "active"),
        eq(organizations.status, "active"),
      ),
    );

  if (!current) throw new UnauthorizedError("Usuário ou organização inativos");
  return current;
}

export async function requireOwnerOrAdmin(): Promise<SessionPayload> {
  const session = await requireOrganization();
  if (session.role !== "owner" && session.role !== "admin") {
    throw new ForbiddenError("Permissão administrativa necessária");
  }
  return session;
}

/** Alias semântico para rotas mutáveis administrativas. */
export const requireAdmin = requireOwnerOrAdmin;
