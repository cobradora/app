import { NextRequest, NextResponse } from "next/server";
import { verifyWhatsappWebhookSignature } from "@/lib/whatsapp";
import { processWhatsappDeliveryStatuses } from "@/services/whatsapp-notifications";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

async function readBodyWithLimit(request: NextRequest): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let rawBody = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    rawBody += decoder.decode(value, { stream: true });
  }
  return rawBody + decoder.decode();
}

/**
 * Handshake de verificação exigido pela Meta ao cadastrar a URL do webhook
 * no App Dashboard (WhatsApp → Configuration → Webhook). Só confirma a URL
 * se responder 200 com o hub.challenge recebido.
 */
export async function GET(request: NextRequest) {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error("CobraDora: WHATSAPP_WEBHOOK_VERIFY_TOKEN ausente");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verification_failed" }, { status: 403 });
}

/**
 * Eventos de status (enviado/entregue/lido/falhou) e mensagens recebidas.
 * Mensagens recebidas continuam sem comandos automáticos, mas os receipts
 * conhecidos atualizam a outbox pelo `messages[].id` devolvido pela Meta.
 */
export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("CobraDora: WHATSAPP_APP_SECRET ausente");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const rawBody = await readBodyWithLimit(request);
  if (rawBody === null) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  if (!verifyWhatsappWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("CobraDora: payload do webhook do WhatsApp não é JSON válido");
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const result = await processWhatsappDeliveryStatuses(payload);
  return NextResponse.json({ ok: true, updated: result.updated });
}
