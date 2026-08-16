import { NextRequest, NextResponse } from "next/server";
import {
  checkInfinitePayPayment,
  InvalidRecoveryTokenError,
  PaymentConfirmationError,
} from "@/services/webhook-processing";
import { assertTrustedOrigin } from "@/lib/origin-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { z } from "zod";

const MAX_BODY_BYTES = 1024;
// Mais tolerante que as outras rotas públicas: a tela de checkout faz
// polling ativo enquanto aguarda a confirmação do pagamento.
const RATE_LIMIT_PER_MINUTE = 30;
const paymentCheckInput = z
  .object({
    recoveryToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
    transactionNsu: z.string().min(1).max(200),
    invoiceSlug: z.string().min(1).max(200),
  })
  .strict();

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!assertTrustedOrigin(request)) {
    return noStoreJson({ error: "forbidden" }, 403);
  }
  if (!(await checkRateLimit(`payment-check:${getClientIp(request)}`, RATE_LIMIT_PER_MINUTE, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store, max-age=0" } });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return noStoreJson({ error: "request_too_large" }, 413);
  }

  try {
    const { sessionId } = await params;
    const validSessionId = z.string().uuid().parse(sessionId);
    const input = paymentCheckInput.parse(JSON.parse(rawBody));
    const result = await checkInfinitePayPayment({ sessionId: validSessionId, ...input });
    return noStoreJson({ payment: result }, 200);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return noStoreJson({ error: "validation_error" }, 400);
    }
    if (error instanceof InvalidRecoveryTokenError) {
      return noStoreJson({ error: "invalid_recovery" }, 401);
    }
    if (error instanceof PaymentConfirmationError) {
      return noStoreJson({ error: error.code, message: "Não foi possível confirmar este pagamento" }, 409);
    }

    console.error("payment_check InfinitePay falhou", error);
    return noStoreJson({ error: "payment_check_unavailable" }, 503);
  }
}
