import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { devicePushTokens } from "@/db/schema";
import { z } from "zod";
import { requireOrganizationFromBearerToken, UnauthorizedError } from "@/lib/auth-context";

const pushTokenInput = z.object({
  expoPushToken: z.string().min(1).max(200),
  platform: z.enum(["ios", "android"]),
});

/**
 * Registra (ou atualiza, se o device já existia) o token Expo Push do app
 * mobile. Upsert pelo próprio token: reinstalar/logar de novo no mesmo
 * device deve substituir o dono do token, não duplicar linha.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireOrganizationFromBearerToken(request);
    const input = pushTokenInput.parse(await request.json());

    await db
      .insert(devicePushTokens)
      .values({
        userId: session.userId,
        organizationId: session.organizationId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
      })
      .onConflictDoUpdate({
        target: devicePushTokens.expoPushToken,
        set: {
          userId: session.userId,
          organizationId: session.organizationId,
          platform: input.platform,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
