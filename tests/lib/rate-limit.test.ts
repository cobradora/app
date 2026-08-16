import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { truncateAll } from "../helpers/db";

describe("rate-limit", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("libera até o limite e bloqueia a partir daí, na mesma janela", async () => {
    const key = "test-key-1";
    expect(await checkRateLimit(key, 3, 60)).toBe(true);
    expect(await checkRateLimit(key, 3, 60)).toBe(true);
    expect(await checkRateLimit(key, 3, 60)).toBe(true);
    expect(await checkRateLimit(key, 3, 60)).toBe(false);
    expect(await checkRateLimit(key, 3, 60)).toBe(false);
  });

  it("não mistura contadores de chaves diferentes", async () => {
    expect(await checkRateLimit("key-a", 1, 60)).toBe(true);
    expect(await checkRateLimit("key-a", 1, 60)).toBe(false);
    expect(await checkRateLimit("key-b", 1, 60)).toBe(true);
  });

  it("libera de novo numa nova janela", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00.000Z"));
    const key = "test-key-window";
    expect(await checkRateLimit(key, 1, 60)).toBe(true);
    expect(await checkRateLimit(key, 1, 60)).toBe(false);

    vi.setSystemTime(new Date("2026-08-16T10:01:05.000Z"));
    expect(await checkRateLimit(key, 1, 60)).toBe(true);
  });

  it("getClientIp lê o primeiro IP de x-forwarded-for, com fallback pra 'unknown'", () => {
    const withHeader = new Request("http://localhost/x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } });
    expect(getClientIp(withHeader)).toBe("203.0.113.5");

    const withoutHeader = new Request("http://localhost/x");
    expect(getClientIp(withoutHeader)).toBe("unknown");
  });
});
