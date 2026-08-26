import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/whatsapp-notifications", () => ({
  processWhatsappDeliveryStatuses: vi.fn(),
}));

import { POST } from "@/app/api/webhooks/whatsapp/route";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const APP_SECRET = "test-app-secret";
const WEBHOOK_URL = "http://localhost/api/webhooks/whatsapp";

describe("POST /api/webhooks/whatsapp - limite do corpo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejeita pelo Content-Length declarado acima de 64 KiB", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    const request = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-length": String(MAX_WEBHOOK_BODY_BYTES + 1) },
      body: "{}",
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "payload_too_large" });
  });

  it("rejeita um corpo acima de 64 KiB mesmo sem Content-Length", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    const request = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
    });
    expect(request.headers.has("content-length")).toBe(false);

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "payload_too_large" });
  });

  it("aceita exatamente 64 KiB e só então rejeita o JSON inválido", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = "x".repeat(MAX_WEBHOOK_BODY_BYTES);
    const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
    const request = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
  });
});
