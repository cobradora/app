import { db } from "@/db";
import { appNotifications, devicePushTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Registra o evento no feed do app (sempre, para histórico/auditoria) e
 * tenta enviar o push via Expo pros devices registrados dessa organização.
 * Best-effort: sem outbox/retry — se o push falhar, só loga; a linha em
 * app_notifications já ficou gravada independente disso.
 */
export async function notifyOrganizationEvent(
  organizationId: string,
  kind: string,
  title: string,
  body: string,
  payload?: unknown,
): Promise<void> {
  await db.insert(appNotifications).values({
    organizationId,
    kind,
    title,
    body,
    payload: payload ?? null,
  });

  const tokens = await db
    .select({ expoPushToken: devicePushTokens.expoPushToken })
    .from(devicePushTokens)
    .where(eq(devicePushTokens.organizationId, organizationId));
  if (tokens.length === 0) return;

  try {
    const response = await fetch(EXPO_PUSH_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify(
        tokens.map((token) => ({
          to: token.expoPushToken,
          title,
          body,
        })),
      ),
    });
    if (!response.ok) {
      console.error("CobraDora: falha ao enviar push notification", { organizationId, kind, status: response.status });
    }
  } catch (error) {
    console.error("CobraDora: erro ao chamar a API de push da Expo", {
      organizationId,
      kind,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
