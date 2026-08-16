import { describe, it, expect, afterEach, vi } from "vitest";
import { assertTrustedOrigin } from "@/lib/origin-guard";

describe("origin-guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("libera sempre fora de produção, mesmo com origem errada", () => {
    vi.stubEnv("NODE_ENV", "test");
    const request = new Request("http://localhost/x", { headers: { origin: "https://evil.example.com" } });
    expect(assertTrustedOrigin(request)).toBe(true);
  });

  it("em produção, aceita Origin igual ao APP_BASE_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://cobradora.com.br");
    const request = new Request("http://localhost/x", { headers: { origin: "https://cobradora.com.br" } });
    expect(assertTrustedOrigin(request)).toBe(true);
  });

  it("em produção, aceita Origin com www quando APP_BASE_URL não tem www (e vice-versa)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://cobradora.com.br");
    const withWww = new Request("http://localhost/x", { headers: { origin: "https://www.cobradora.com.br" } });
    expect(assertTrustedOrigin(withWww)).toBe(true);

    vi.stubEnv("APP_BASE_URL", "https://www.cobradora.com.br");
    const withoutWww = new Request("http://localhost/x", { headers: { origin: "https://cobradora.com.br" } });
    expect(assertTrustedOrigin(withoutWww)).toBe(true);
  });

  it("em produção, rejeita Origin diferente do APP_BASE_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://cobradora.com.br");
    const request = new Request("http://localhost/x", { headers: { origin: "https://evil.example.com" } });
    expect(assertTrustedOrigin(request)).toBe(false);
  });

  it("em produção, cai para o Referer quando não há Origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://cobradora.com.br");
    const request = new Request("http://localhost/x", { headers: { referer: "https://cobradora.com.br/g/algum-grupo" } });
    expect(assertTrustedOrigin(request)).toBe(true);
  });

  it("em produção, rejeita quando não há Origin nem Referer", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://cobradora.com.br");
    const request = new Request("http://localhost/x");
    expect(assertTrustedOrigin(request)).toBe(false);
  });
});
