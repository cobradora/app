import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "@/lib/api-client";

function mockFetchOnce(response: { ok: boolean; json: () => Promise<unknown> }) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response);
}

describe("apiClient", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("listGroups faz GET /api/groups e retorna groups", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ groups: [{ id: "g1", name: "Vôlei" }] }) });

    const groups = await apiClient.listGroups();

    expect(global.fetch).toHaveBeenCalledWith("/api/groups", expect.objectContaining({ method: "GET" }));
    expect(groups).toEqual([{ id: "g1", name: "Vôlei" }]);
  });

  it("createGroup faz POST /api/groups com o body serializado e retorna group", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ group: { id: "g2", name: "Futebol" } }) });

    const group = await apiClient.createGroup({ name: "Futebol", billingDay: 5, defaultAmount: 8000 });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Futebol", billingDay: 5, defaultAmount: 8000 }),
      }),
    );
    expect(group).toEqual({ id: "g2", name: "Futebol" });
  });

  it("generateBillingPeriod faz POST /api/groups/:groupId/billing-periods e retorna billingPeriod", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ billingPeriod: { id: "bp1", referenceMonth: "2026-08" } }) });

    const period = await apiClient.generateBillingPeriod("g1", "2026-08");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/groups/g1/billing-periods",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ referenceMonth: "2026-08" }) }),
    );
    expect(period).toEqual({ id: "bp1", referenceMonth: "2026-08" });
  });

  it("registerManualSettlement faz POST /api/charges/:chargeId/manual-settlement", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ ok: true }) });

    await apiClient.registerManualSettlement("c1", { paymentMethod: "dinheiro", observation: "Pago na quadra" });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/charges/c1/manual-settlement",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ paymentMethod: "dinheiro", observation: "Pago na quadra" }),
      }),
    );
  });

  it("listPendingCharges faz GET na rota publica com o telefone via query string", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ pending: [{ chargeId: "c1", totalAmount: 8000 }] }) });

    const pending = await apiClient.listPendingCharges("volei-quarta-ab12", "(11) 98812-4410");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/public/groups/volei-quarta-ab12/pending-charges?phone=" + encodeURIComponent("(11) 98812-4410"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(pending).toEqual([{ chargeId: "c1", totalAmount: 8000 }]);
  });

  it("createCheckout faz POST na rota publica de checkout e retorna os dados da sessao", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({ checkout: { checkoutSessionId: "cs1", checkoutUrl: "https://pay.example/cs1", totalChargesAmount: 8000 } }),
    });

    const result = await apiClient.createCheckout("volei-quarta-ab12", "(11) 98812-4410", ["c1"], "idempotency-key-123");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/public/groups/volei-quarta-ab12/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phone: "(11) 98812-4410", chargeIds: ["c1"], idempotencyKey: "idempotency-key-123" }),
      }),
    );
    expect(result).toEqual({ checkoutSessionId: "cs1", checkoutUrl: "https://pay.example/cs1", totalChargesAmount: 8000 });
  });

  it("lanca erro legivel quando a API responde com validation_error", async () => {
    mockFetchOnce({ ok: false, json: async () => ({ error: "validation_error", issues: [{ message: "Nome obrigatório" }] }) });

    await expect(apiClient.createGroup({ name: "", billingDay: 5, defaultAmount: 8000 })).rejects.toThrow(
      "Nome obrigatório",
    );
  });

  it("lanca erro legivel usando message quando nao ha issues", async () => {
    mockFetchOnce({ ok: false, json: async () => ({ error: "settlement_failed", message: "Cobrança já está paga" }) });

    await expect(apiClient.registerManualSettlement("c1", { paymentMethod: "outro" })).rejects.toThrow(
      "Cobrança já está paga",
    );
  });

  it("lanca erro generico quando o corpo de erro nao tem issues nem message", async () => {
    mockFetchOnce({ ok: false, json: async () => ({ error: "unauthorized" }) });

    await expect(apiClient.listGroups()).rejects.toThrow("unauthorized");
  });
});
