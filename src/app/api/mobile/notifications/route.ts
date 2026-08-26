import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appNotifications } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireOrganizationFromBearerToken, UnauthorizedError } from "@/lib/auth-context";

/** Lista as últimas notificações da organização do usuário logado, para a
 * lista simples do app mobile (notificador). */
export async function GET(request: NextRequest) {
  try {
    const session = await requireOrganizationFromBearerToken(request);

    const notifications = await db
      .select({
        id: appNotifications.id,
        kind: appNotifications.kind,
        title: appNotifications.title,
        body: appNotifications.body,
        payload: appNotifications.payload,
        createdAt: appNotifications.createdAt,
      })
      .from(appNotifications)
      .where(eq(appNotifications.organizationId, session.organizationId))
      .orderBy(desc(appNotifications.createdAt))
      .limit(50);

    return NextResponse.json({ notifications });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }
}
