import { describe, it, expect, vi, afterEach } from "vitest";
import { sendPaymentReminderTemplate, verifyWhatsappWebhookSignature } from "@/lib/whatsapp";
import { createHmac } from "node:crypto";

describe("whatsapp lib - sendPaymentReminderTemplate", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("envia o payload de template com as variáveis na ordem certa", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
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
    expect(body.template.name).toBe("cobranca_pendente");
    expect(body.template.language).toEqual({ code: "pt_BR" });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Maria",
      "Vôlei de quinta",
      "R$ 80,00",
      "10/08/2026",
      "https://cobradora.com.br/g/volei-abc",
    ]);
  });

  it("lança erro legível quando a Meta responde com falha", async () => {
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
