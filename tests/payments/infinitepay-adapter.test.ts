import { describe, it, expect, vi, afterEach } from "vitest";
import { createInfinitePayAdapter } from "@/payments/infinitepay-adapter";

function baseInput(overrides: Partial<Parameters<ReturnType<typeof createInfinitePayAdapter>["createCheckout"]>[0]> = {}) {
  return {
    organizationId: "org-1",
    participantId: "part-1",
    amount: 1000,
    splits: [],
    dueDate: "2026-08-10",
    idempotencyKey: "idem-1",
    gatewayExternalAccountId: "handle-teste",
    externalReference: "session-1",
    webhookToken: "token-1",
    ...overrides,
  };
}

describe("infinitepay adapter - createCheckout", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejeita quando a InfinitePay retorna uma URL fora dos dominios permitidos", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://evil.example.com/checkout/abc" }),
      text: async () => "",
    }) as unknown as typeof fetch;

    const adapter = createInfinitePayAdapter();

    await expect(adapter.createCheckout(baseInput())).rejects.toThrow(/dom[ií]nio/i);
  });

  it("aceita e retorna a URL quando o dominio e valido (checkout.infinitepay.io)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.infinitepay.io/abc123" }),
      text: async () => "",
    }) as unknown as typeof fetch;

    const adapter = createInfinitePayAdapter();

    const result = await adapter.createCheckout(baseInput());

    expect(result.checkoutUrl).toBe("https://checkout.infinitepay.io/abc123");
    expect(result.gatewayCheckoutId).toBe("session-1");
  });

  it("aceita URL no dominio checkout.infinitepay.com.br", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.infinitepay.com.br/xyz" }),
      text: async () => "",
    }) as unknown as typeof fetch;

    const adapter = createInfinitePayAdapter();
    const result = await adapter.createCheckout(baseInput());
    expect(result.checkoutUrl).toBe("https://checkout.infinitepay.com.br/xyz");
  });

  it("envia handle, order_nsu e webhook_url com token na chamada POST /links", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.infinitepay.io/abc123" }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createInfinitePayAdapter();
    await adapter.createCheckout(baseInput());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/links");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.handle).toBe("handle-teste");
    expect(body.order_nsu).toBe("session-1");
    expect(body.webhook_url).toContain("token=token-1");
  });

  it("envia customer.name e customer.phone_number quando buyerName/buyerPhone sao informados", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.infinitepay.io/abc123" }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createInfinitePayAdapter();
    await adapter.createCheckout(baseInput({ buyerName: "Maria Silva", buyerPhone: "+5511999999999" }));

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.customer).toEqual({ name: "Maria Silva", phone_number: "+5511999999999" });
  });

  it("nao inclui customer quando buyerPhone nao e informado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.infinitepay.io/abc123" }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createInfinitePayAdapter();
    await adapter.createCheckout(baseInput());

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.customer).toBeUndefined();
  });

  it("nao inclui customer quando buyerPhone e informado mas buyerName esta vazio (evita 422 da InfinitePay)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.infinitepay.io/abc123" }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createInfinitePayAdapter();
    await adapter.createCheckout(baseInput({ buyerPhone: "+5511999999999", buyerName: "" }));

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.customer).toBeUndefined();
  });
});

describe("infinitepay adapter - parseWebhook", () => {
  it("mapeia transaction_nsu para gatewayPaymentId e externalEventId", () => {
    const adapter = createInfinitePayAdapter();
    const parsed = adapter.parseWebhook(
      JSON.stringify({ order_nsu: "session-1", transaction_nsu: 987654, amount: 1000 }),
    );
    expect(parsed.gatewayPaymentId).toBe("987654");
    expect(parsed.externalEventId).toBe("987654");
    expect(parsed.eventType).toBe("payment.confirmed");
  });
});
