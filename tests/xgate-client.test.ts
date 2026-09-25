import { describe, expect, it, vi } from "vitest";
import { XGateClient, XGateError, centsToXGateAmount, xgateAmountToCents } from "../src/payments/xgate-client";

const currency = { _id: "brl-deposit", name: "BRL" as const, type: "PIX" as const, symbol: "R$", __v: 0 };
const order = { amountCents: 10001, customerId: "payer", externalId: "persistent-local-id", currency };
const deposit = { data: { id: "deposit-id", code: "pix-copy-paste", status: "WAITING_PAYMENT", customerId: "payer" } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function mockClient() {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ token: "opaque-token" }));
  return { transport, client: new XGateClient({ email: "operator@example.com", password: "never-log-me", fetch: transport, timeoutMs: 100 }) };
}

describe("XGate client", () => {
  it("sends integer cents as BRL, stable externalId and full currency object", async () => {
    const { client, transport } = mockClient();
    transport.mockResolvedValueOnce(json(deposit, 201));
    expect(await client.createDeposit(order)).toEqual(deposit);
    expect(transport.mock.calls[1][0]).toBe("https://api.xgateglobal.com/deposit");
    const options = transport.mock.calls[1][1]!;
    expect(JSON.parse(options.body as string)).toEqual({ amount: 100.01, customerId: "payer", externalId: order.externalId, currency });
    expect(options.redirect).toBe("error");
  });

  it("shares authentication for concurrent requests and caches it", async () => {
    const { client, transport } = mockClient();
    transport.mockImplementation(async () => json({ _id: "customer", document: "12345678901" }));
    await Promise.all([client.getCustomer("customer"), client.getCustomer("customer")]);
    await client.getCustomer("customer");
    expect(transport.mock.calls.filter(([url]) => String(url).endsWith("/auth/token"))).toHaveLength(1);
  });

  it.each([409, 408, 429, 500, 502])("keeps HTTP %s writes unknown without replay", async (status) => {
    const { client, transport } = mockClient();
    transport.mockResolvedValueOnce(json({ message: "secret personal data" }, status));
    await expect(client.createDeposit(order)).rejects.toMatchObject({ outcome: "unknown", httpStatus: status });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("treats a transport failure as ambiguous and never exposes its message", async () => {
    const { client, transport } = mockClient();
    transport.mockRejectedValueOnce(new Error("never-log-me"));
    await expect(client.createDeposit(order)).rejects.toMatchObject({ outcome: "unknown", message: "Resposta XGate indisponível ou inconclusiva." });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("aborts an unanswered operation at its deadline", async () => {
    const { client, transport } = mockClient();
    transport.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    await expect(client.createDeposit(order)).rejects.toMatchObject({ outcome: "unknown", code: "transport" });
  });

  it("classifies malformed successful write responses as unknown", async () => {
    const { client, transport } = mockClient();
    transport.mockResolvedValueOnce(json({ message: "created but no ID" }, 201));
    await expect(client.createDeposit(order)).rejects.toMatchObject({ outcome: "unknown", code: "response" });
  });

  it("refreshes expired credentials for reads once", async () => {
    const { client, transport } = mockClient();
    transport.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ token: "new-token" })).mockResolvedValueOnce(json({ _id: "customer" }));
    expect(await client.getCustomer("customer")).toEqual({ _id: "customer" });
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("does not replay an unauthorized write", async () => {
    const { client, transport } = mockClient();
    transport.mockResolvedValueOnce(json({}, 401));
    await expect(client.createDeposit(order)).rejects.toMatchObject({ outcome: "rejected", httpStatus: 401 });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not equate approval with settlement", async () => {
    const { client, transport } = mockClient();
    transport.mockResolvedValueOnce(json({ _id: "withdraw", customerId: "payer", status: "APPROVED", currency: { name: "BRL", type: "PIX", amount: 100, status: "PENDING" } }));
    expect((await client.getWithdrawal("withdraw")).currency.status).toBe("PENDING");
  });

  it("selects BRL/PIX rather than the first currency", async () => {
    const { client, transport } = mockClient();
    transport.mockResolvedValueOnce(json([{ _id: "usd", name: "USD" }, currency]));
    expect(await client.getBrlCurrency("deposit")).toEqual(currency);
  });

  it("sends the full registered Pix key on withdrawal", async () => {
    const { client, transport } = mockClient();
    const pixKey = { _id: "key-id", key: "owner@example.com", type: "EMAIL" as const };
    transport.mockResolvedValueOnce(json({ _id: "withdraw", status: "PENDING" }, 201));
    await client.createWithdrawal({ ...order, pixKey });
    expect(JSON.parse(transport.mock.calls[1][1]!.body as string).pixKey).toEqual(pixKey);
  });

  it("requires persistent idempotency IDs and positive integer cents before HTTP", () => {
    const { client, transport } = mockClient();
    expect(() => client.createDeposit({ ...order, externalId: "" })).toThrow(XGateError);
    expect(() => client.createDeposit({ ...order, amountCents: 1.5 })).toThrow(XGateError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("validates amounts without floating point cent truncation", () => {
    expect(xgateAmountToCents(0.29)).toBe(29);
    expect(centsToXGateAmount(29)).toBe(0.29);
    for (const value of [NaN, Infinity, -1, 1.001]) expect(() => xgateAmountToCents(value)).toThrow();
    for (const value of [0, -1, 0.1, NaN, Number.MAX_SAFE_INTEGER]) expect(() => centsToXGateAmount(value)).toThrow();
  });
});
