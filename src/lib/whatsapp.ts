import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH_API_VERSION = "v21.0";

type SendTemplateInput = {
  participantName: string;
  groupName: string;
  amount: string;
  dueDate: string;
  groupUrl: string;
};

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!accessToken || !phoneNumberId || !templateName) {
    throw new Error("Configuração do WhatsApp Cloud API ausente (WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_TEMPLATE_NAME)");
  }
  return { accessToken, phoneNumberId, templateName };
}

/**
 * Envia o template de lembrete de cobrança pendente (categoria Utility,
 * pré-aprovado pela Meta) para um número no formato E.164 (ex.: +5511999999999).
 * Mensagem de texto livre não é permitida aqui — fora da janela de 24h aberta
 * pelo usuário, a Meta só aceita templates pré-aprovados.
 */
export async function sendPaymentReminderTemplate(to: string, input: SendTemplateInput): Promise<void> {
  const { accessToken, phoneNumberId, templateName } = getConfig();

  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: input.participantName },
              { type: "text", text: input.groupName },
              { type: "text", text: input.amount },
              { type: "text", text: input.dueDate },
              { type: "text", text: input.groupUrl },
            ],
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`WhatsApp Cloud API falhou: ${response.status} ${detail}`);
  }
}

/**
 * Valida a assinatura X-Hub-Signature-256 do webhook (HMAC-SHA256 do corpo
 * bruto com o App Secret). rawBody precisa ser o texto exatamente como
 * recebido, antes de qualquer JSON.parse/reserialização.
 */
export function verifyWhatsappWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const received = Buffer.from(signatureHeader.slice("sha256=".length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
