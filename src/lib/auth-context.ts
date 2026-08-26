import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { SESSION_COOKIE_NAME, verifySession, type SessionPayload } from "@/lib/session";

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

async function resolveSession(token: string | undefined): Promise<SessionPayload> {
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

export async function requireOrganization(): Promise<SessionPayload> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return resolveSession(token);
}

/** Mesma verificação de requireOrganization, para chamadas do app mobile
 * autenticadas via `Authorization: Bearer <token>` em vez de cookie. */
export async function requireOrganizationFromBearerToken(request: NextRequest): Promise<SessionPayload> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
  return resolveSession(token);
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
