import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sendOrganizerListUpdateTemplate,
  sendOrganizerNewCycleTemplate,
  sendPaymentReminderTemplate,
  verifyWhatsappWebhookSignature,
} from "@/lib/whatsapp";
import { createHmac } from "node:crypto";

describe("whatsapp lib - sendPaymentReminderTemplate", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("envia o payload de template com as variáveis na ordem certa", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "false");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.cobranca-teste" }] }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendPaymentReminderTemplate("+5511999999999", {
      participantName: "Maria",
      groupName: "Vôlei de quinta",
      amount: "R$ 80,00",
      dueDate: "10/08/2026",
      groupUrl: "https://cobradora.com.br/g/volei-abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("test-phone-number-id/messages");
    expect((options as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-token" });
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.to).toBe("+5511999999999");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("cobranca");
    expect(body.template.language).toEqual({ code: "pt_BR" });
    // Cabeçalho do "cobranca" é texto estático (sem {{n}}); só o corpo tem
    // parâmetros, e amount/dueDate não fazem parte do texto aprovado.
    expect(body.template.components).toHaveLength(1);
    expect(body.template.components[0].type).toBe("body");
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Maria",
      "Vôlei de quinta",
      "https://cobradora.com.br/g/volei-abc",
    ]);
  });

  it("lança erro legível quando a Meta responde com falha", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "false");
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "template not approved" }) as unknown as typeof fetch;

    await expect(
      sendPaymentReminderTemplate("+5511999999999", {
        participantName: "Maria",
        groupName: "Vôlei",
        amount: "R$ 80,00",
        dueDate: "10/08/2026",
        groupUrl: "https://cobradora.com.br/g/volei-abc",
      }),
    ).rejects.toThrow(/400/);
  });

  it("rejeita HTTP 2xx sem messages[0].id sem expor o corpo da Meta", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "false");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], diagnostic: "corpo-sensível-da-meta" }),
      text: async () => "corpo-sensível-da-meta",
    }) as unknown as typeof fetch;

    const error = await sendPaymentReminderTemplate("+5511999999999", {
      participantName: "Maria",
      groupName: "Vôlei",
      amount: "R$ 80,00",
      dueDate: "10/08/2026",
      groupUrl: "https://cobradora.com.br/g/volei-abc",
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("WhatsApp Cloud API respondeu sem identificador da mensagem");
    expect((error as Error).message).not.toContain("corpo-sensível-da-meta");
  });

  it("envia o template definitivo novo_ciclo com os parâmetros na ordem contratada", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_ORGANIZER_CYCLE_TEMPLATE_NAME", "novo_ciclo");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "false");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.novo-ciclo-teste" }] }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendOrganizerNewCycleTemplate("+5511999999999", {
      groupName: "Vôlei de quinta",
      referenceMonth: "08/2026",
      participantCount: "12",
      totalAmount: "R$ 960,00",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.template.name).toBe("novo_ciclo");
    expect(body.template.language).toEqual({ code: "pt_BR" });
    // Cabeçalho e corpo têm numeração de {{n}} independente na Meta;
    // participantCount/totalAmount não fazem parte do texto aprovado.
    expect(body.template.components).toHaveLength(2);
    expect(body.template.components[0]).toEqual({
      type: "header",
      parameters: [{ type: "text", text: "Vôlei de quinta" }],
    });
    expect(body.template.components[1]).toEqual({
      type: "body",
      parameters: [
        { type: "text", text: "Vôlei de quinta" },
        { type: "text", text: "08/2026" },
      ],
    });
  });

  it("envia o template definitivo notificacao_organizador com cabeçalho e corpo separados", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_ORGANIZER_UPDATE_TEMPLATE_NAME", "notificacao_organizador");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "false");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.notificacao-organizador-teste" }] }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendOrganizerListUpdateTemplate("+5511999999999", {
      groupName: "Vôlei de quinta",
      referenceMonth: "08/2026",
      paidList: "João, Maria",
      pendingList: "Pedro",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.template.name).toBe("notificacao_organizador");
    expect(body.template.components).toHaveLength(2);
    expect(body.template.components[0]).toEqual({
      type: "header",
      parameters: [{ type: "text", text: "Vôlei de quinta" }],
    });
    expect(body.template.components[1]).toEqual({
      type: "body",
      parameters: [
        { type: "text", text: "08/2026" },
        { type: "text", text: "João, Maria" },
        { type: "text", text: "Pedro" },
      ],
    });
  });

  it("usa o template de integração em todas as mensagens, em en_US e sem components, somente no modo explícito", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "true");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.integracao-teste" }] }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await Promise.all([
      sendPaymentReminderTemplate("+5511999999999", {
        participantName: "ignorado",
        groupName: "ignorado",
        amount: "ignorado",
        dueDate: "ignorado",
        groupUrl: "https://example.com/ignorado",
      }),
      sendOrganizerNewCycleTemplate("+5511999999999", {
        groupName: "ignorado",
        referenceMonth: "ignorado",
        participantCount: "ignorado",
        totalAmount: "ignorado",
      }),
      sendOrganizerListUpdateTemplate("+5511999999999", {
        groupName: "ignorado",
        referenceMonth: "01/2026",
        paidList: "ignorado",
        pendingList: "ignorado",
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, options] of fetchMock.mock.calls) {
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.template).toEqual({
        name: "3p_direct_integration_test_template",
        language: { code: "en_US" },
      });
      expect(body.template).not.toHaveProperty("components");
    }
  });

  it("bloqueia o modo de teste da Meta em produção antes de chamar a API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "true");
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      sendPaymentReminderTemplate("+5511999999999", {
        participantName: "Maria",
        groupName: "Vôlei",
        amount: "R$ 80,00",
        dueDate: "10/08/2026",
        groupUrl: "https://cobradora.com.br/g/volei-abc",
      }),
    ).rejects.toThrow(/bloqueado em produção/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejeita o template de teste configurado como se fosse definitivo", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "3p_direct_integration_test_template");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "false");
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      sendPaymentReminderTemplate("+5511999999999", {
        participantName: "Maria",
        groupName: "Vôlei",
        amount: "R$ 80,00",
        dueDate: "10/08/2026",
        groupUrl: "https://cobradora.com.br/g/volei-abc",
      }),
    ).rejects.toThrow(/exige WHATSAPP_META_TEST_MODE=true/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha fechado quando WHATSAPP_META_TEST_MODE não é booleano explícito", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-phone-number-id");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca");
    vi.stubEnv("WHATSAPP_META_TEST_MODE", "1");
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      sendPaymentReminderTemplate("+5511999999999", {
        participantName: "Maria",
        groupName: "Vôlei",
        amount: "R$ 80,00",
        dueDate: "10/08/2026",
        groupUrl: "https://cobradora.com.br/g/volei-abc",
      }),
    ).rejects.toThrow(/use somente true ou false/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("whatsapp lib - verifyWhatsappWebhookSignature", () => {
  const secret = "test-app-secret";

  it("aceita assinatura válida", () => {
    const body = JSON.stringify({ hello: "world" });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWhatsappWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejeita assinatura com segredo errado", () => {
    const body = JSON.stringify({ hello: "world" });
    const signature = `sha256=${createHmac("sha256", "outro-segredo").update(body).digest("hex")}`;
    expect(verifyWhatsappWebhookSignature(body, signature, secret)).toBe(false);
  });

  it("rejeita quando o header está ausente ou mal formatado", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifyWhatsappWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWhatsappWebhookSignature(body, "not-sha256=abc", secret)).toBe(false);
  });
});
