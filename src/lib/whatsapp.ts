import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_GRAPH_API_VERSION = "v25.0";
const META_DIRECT_INTEGRATION_TEST_TEMPLATE = "3p_direct_integration_test_template";

type TemplateDefinition = {
  name: string;
  languageCode: string;
  headerParameters: string[];
  bodyParameters: string[];
};

export class WhatsappSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "WhatsappSendError";
  }
}

function graphApiVersion(): string {
  const configured = process.env.WHATSAPP_GRAPH_API_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_API_VERSION;
}

export type SendChargeTemplateInput = {
  participantName: string;
  groupName: string;
  amount: string;
  dueDate: string;
  groupUrl: string;
};

export type SendOrganizerUpdateTemplateInput = {
  groupName: string;
  referenceMonth: string;
  paidList: string;
  pendingList: string;
};

export type SendOrganizerNewCycleTemplateInput = {
  groupName: string;
  referenceMonth: string;
  participantCount: string;
  totalAmount: string;
};

function getBaseConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new WhatsappSendError(
      "not_configured",
      "Configuração do WhatsApp Cloud API ausente (WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID)",
    );
  }
  return { accessToken, phoneNumberId };
}

function metaTestModeEnabled(): boolean {
  const configured = process.env.WHATSAPP_META_TEST_MODE?.trim().toLowerCase();
  if (!configured || configured === "false") return false;
  if (configured !== "true") {
    throw new WhatsappSendError(
      "configuration_invalid",
      "WHATSAPP_META_TEST_MODE inválido: use somente true ou false",
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new WhatsappSendError("template_not_configured", "Template de teste da Meta bloqueado em produção");
  }
  return true;
}

function resolveTemplate(
  templateName: string,
  bodyParameters: string[],
  headerParameters: string[],
): TemplateDefinition {
  if (metaTestModeEnabled()) {
    return {
      name: META_DIRECT_INTEGRATION_TEST_TEMPLATE,
      languageCode: "en_US",
      headerParameters: [],
      bodyParameters: [],
    };
  }
  if (templateName.trim() === META_DIRECT_INTEGRATION_TEST_TEMPLATE) {
    throw new WhatsappSendError(
      "template_not_configured",
      "Template de teste da Meta exige WHATSAPP_META_TEST_MODE=true fora de produção",
    );
  }
  return { name: templateName, languageCode: "pt_BR", headerParameters, bodyParameters };
}

function retryAfterMilliseconds(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const maximum = 7 * 24 * 60 * 60_000;
  const seconds = Number(headerValue.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maximum, seconds * 1_000);
  const retryAt = Date.parse(headerValue);
  if (!Number.isFinite(retryAt)) return null;
  return Math.min(maximum, Math.max(0, retryAt - Date.now()));
}

async function sendTemplate(
  to: string,
  templateName: string,
  bodyParameters: string[],
  headerParameters: string[] = [],
): Promise<string | null> {
  const { accessToken, phoneNumberId } = getBaseConfig();
  const definition = resolveTemplate(templateName, bodyParameters, headerParameters);
  if (!definition.name.trim()) {
    throw new WhatsappSendError("template_not_configured", "Nome do template do WhatsApp ausente");
  }
  // Cabeçalho e corpo têm numeração de {{n}} independente entre si na Meta;
  // por isso são componentes separados, cada um com sua própria lista.
  const components: { type: "header" | "body"; parameters: { type: "text"; text: string }[] }[] = [];
  if (definition.headerParameters.length > 0) {
    components.push({
      type: "header",
      parameters: definition.headerParameters.map((value) => ({ type: "text", text: value })),
    });
  }
  if (definition.bodyParameters.length > 0) {
    components.push({
      type: "body",
      parameters: definition.bodyParameters.map((value) => ({ type: "text", text: value })),
    });
  }
  const template: {
    name: string;
    language: { code: string };
    components?: { type: "header" | "body"; parameters: { type: "text"; text: string }[] }[];
  } = {
    name: definition.name,
    language: { code: definition.languageCode },
  };
  if (components.length > 0) template.components = components;

  const response = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template,
    }),
  });

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const retryAfterMs = retryable
      ? retryAfterMilliseconds(response.headers?.get?.("retry-after") ?? null)
      : null;
    // O corpo da Meta pode conter dados operacionais e do destinatário. O
    // erro exposto à outbox preserva apenas o status necessário à política
    // de retry.
    await response.text().catch(() => "");
    throw new WhatsappSendError(
      `graph_api_${response.status}`,
      `WhatsApp Cloud API falhou: ${response.status}`,
      retryable,
      retryAfterMs,
    );
  }

  const payload =
    typeof response.json === "function"
      ? await response.json().catch(() => null) as { messages?: { id?: unknown }[] } | null
      : null;
  const messageId = payload?.messages?.[0]?.id;
  if (typeof messageId !== "string" || messageId.length === 0) {
    throw new WhatsappSendError(
      "invalid_response",
      "WhatsApp Cloud API respondeu sem identificador da mensagem",
      true,
    );
  }
  return messageId;
}

/**
 * Envia o template de lembrete de cobrança pendente (categoria Utility,
 * pré-aprovado pela Meta) para um número no formato E.164 (ex.: +5511999999999).
 * Mensagem de texto livre não é permitida aqui — fora da janela de 24h aberta
 * pelo usuário, a Meta só aceita templates pré-aprovados.
 */
export async function sendPaymentReminderTemplate(
  to: string,
  input: SendChargeTemplateInput,
): Promise<string | null> {
  const templateName = process.env.WHATSAPP_CHARGE_TEMPLATE_NAME ?? process.env.WHATSAPP_TEMPLATE_NAME ?? "";
  // Cabeçalho do template "cobranca" é texto estático (sem {{n}}); amount e
  // dueDate não aparecem no corpo aprovado, por isso ficam de fora do envio.
  return sendTemplate(to, templateName, [input.participantName, input.groupName, input.groupUrl]);
}

/** Template enviado ao organizador quando uma nova competência é gerada. */
export async function sendOrganizerNewCycleTemplate(
  to: string,
  input: SendOrganizerNewCycleTemplateInput,
): Promise<string | null> {
  // participantCount e totalAmount não aparecem no corpo aprovado do
  // "novo_ciclo", por isso ficam de fora do envio.
  return sendTemplate(
    to,
    process.env.WHATSAPP_ORGANIZER_CYCLE_TEMPLATE_NAME ?? "",
    [input.groupName, input.referenceMonth],
    [input.groupName],
  );
}

/** Template separado para o resumo atualizado enviado ao organizador. */
export async function sendOrganizerListUpdateTemplate(
  to: string,
  input: SendOrganizerUpdateTemplateInput,
): Promise<string | null> {
  return sendTemplate(
    to,
    process.env.WHATSAPP_ORGANIZER_UPDATE_TEMPLATE_NAME ?? "",
    [input.referenceMonth, input.paidList, input.pendingList],
    [input.groupName],
  );
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
