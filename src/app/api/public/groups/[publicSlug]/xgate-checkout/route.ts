import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedOrigin } from "@/lib/origin-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createXGateCheckout, XGateDepositError, xgateCheckoutInput } from "@/services/xgate-deposits";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request, { params }: { params: Promise<{ publicSlug: string }> }) {
  if (!assertTrustedOrigin(request)) return reply({ error: "forbidden" }, 403);
  if (!await checkRateLimit(`xgate-create:${getClientIp(request)}`, 10, 60)) return reply({ message: "Aguarde um minuto para tentar novamente." }, 429);
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 8192) return reply({ error: "request_too_large" }, 413);
    const input = xgateCheckoutInput.parse(JSON.parse(raw));
    const { publicSlug } = await params;
    return reply({ checkout: await createXGateCheckout(publicSlug, input) }, 201);
  } catch (error) {
    if (error instanceof XGateDepositError) return reply({ error: error.code, message: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ message: "Confira os dados do pagador e as cobranças selecionadas." }, 400);
    // Rota pública: loga o motivo real só no servidor, nunca no corpo da resposta.
    console.error(`POST /api/public/groups/.../xgate-checkout falhou:`, error);
    return reply({ message: "Não foi possível preparar o Pix. Tente novamente com a mesma seleção." }, 503);
  }
}
