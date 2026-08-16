import { NextRequest, NextResponse } from "next/server";
import { verifyWhatsappWebhookSignature } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

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
 * Por enquanto só valida a assinatura e loga — sem lógica de negócio em
 * cima disso ainda (não respondemos comandos do participante).
 */
export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("CobraDora: WHATSAPP_APP_SECRET ausente");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyWhatsappWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody);
    console.log("CobraDora: evento recebido do webhook do WhatsApp", JSON.stringify(payload));
  } catch {
    console.error("CobraDora: payload do webhook do WhatsApp não é JSON válido");
  }

  return NextResponse.json({ ok: true });
}
