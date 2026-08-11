import { describe, it, expect } from "vitest";
import { createSession, verifySession } from "@/lib/session";

describe("session", () => {
  it("cria e verifica um token contendo organizationId", async () => {
    const token = await createSession({
      userId: "11111111-1111-1111-1111-111111111111",
      organizationId: "22222222-2222-2222-2222-222222222222",
      role: "owner",
    });

    const payload = await verifySession(token);
    expect(payload.organizationId).toBe("22222222-2222-2222-2222-222222222222");
    expect(payload.role).toBe("owner");
  });

  it("rejeita token adulterado", async () => {
    const token = await createSession({
      userId: "11111111-1111-1111-1111-111111111111",
      organizationId: "22222222-2222-2222-2222-222222222222",
      role: "owner",
    });
    const tampered = token.slice(0, -2) + "xx";
    await expect(verifySession(tampered)).rejects.toThrow();
  });
});
