import { NextRequest, NextResponse } from "next/server";
import { processInfinitePayWebhook, InvalidWebhookSignatureError } from "@/services/webhook-processing";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const token = request.nextUrl.searchParams.get("token");

  try {
    await processInfinitePayWebhook(rawBody, token);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) {
      console.error("Webhook InfinitePay: assinatura/token inválido", err);
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
    // Erros de dominio (sessao nao encontrada, valor divergente, payload
    // malformado) nao vazam detalhes internos na resposta — apenas logados
    // no servidor para investigacao.
    console.error("Webhook InfinitePay: falha ao processar", err);
    return NextResponse.json({ error: "webhook_processing_failed" }, { status: 400 });
  }
}
