import { NextRequest, NextResponse } from "next/server";
import {
  processInfinitePayWebhook,
  InvalidWebhookSignatureError,
  WebhookReplayMismatchError,
  PaymentConfirmationError,
} from "@/services/webhook-processing";

const MAX_WEBHOOK_BYTES = 64 * 1024;

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
    return response({ success: false, message: "Payload muito grande" }, 413);
  }
  const token = request.nextUrl.searchParams.get("token");

  try {
    const result = await processInfinitePayWebhook(rawBody, token);
    return response({ success: true, message: null, alreadyProcessed: result.alreadyProcessed }, 200);
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      console.warn("Webhook InfinitePay rejeitado: token inválido");
      return response({ success: false, message: "Webhook não autorizado" }, 401);
    }
    if (error instanceof WebhookReplayMismatchError) {
      console.warn("Webhook InfinitePay rejeitado: replay divergente");
      return response({ success: false, message: "Evento divergente" }, 400);
    }
    if (error instanceof PaymentConfirmationError) {
      console.error("Webhook InfinitePay não confirmado", { code: error.code });
      return response({ success: false, message: "Pagamento não confirmado" }, 400);
    }

    console.error("Webhook InfinitePay: falha de processamento", error);
    return response({ success: false, message: "Falha de processamento" }, 400);
  }
}
