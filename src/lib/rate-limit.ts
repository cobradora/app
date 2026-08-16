import { db } from "@/db";
import { rateLimitHits } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Contador de janela fixa guardado no Postgres — sem Redis/KV no projeto
 * hoje, e o volume das rotas públicas não justifica uma infra nova. O
 * upsert é atômico (ON CONFLICT ... DO UPDATE), então corridas concorrentes
 * na mesma janela não perdem incremento.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);

  const [row] = await db
    .insert(rateLimitHits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitHits.key, rateLimitHits.windowStart],
      set: { count: sql`${rateLimitHits.count} + 1` },
    })
    .returning({ count: rateLimitHits.count });

  return row.count <= limit;
}

/** IP do cliente via header padrão da Vercel; "unknown" agrupa tráfego sem IP identificável no mesmo balde. */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}
