import { describe, it, expect } from "vitest";
import { createPasswordResetToken, verifyPasswordResetToken } from "@/lib/password-reset-token";
import { createSession } from "@/lib/session";

describe("password-reset-token", () => {
  it("cria e verifica um token, extraindo o userId", async () => {
    const token = await createPasswordResetToken("11111111-1111-1111-1111-111111111111");

    const userId = await verifyPasswordResetToken(token);
    expect(userId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejeita token adulterado", async () => {
    const token = await createPasswordResetToken("11111111-1111-1111-1111-111111111111");
    const tampered = token.slice(0, -2) + "xx";
    await expect(verifyPasswordResetToken(tampered)).rejects.toThrow();
  });

  it("rejeita um cookie de sessao normal como se fosse token de reset", async () => {
    const sessionToken = await createSession({
      userId: "11111111-1111-1111-1111-111111111111",
      organizationId: "22222222-2222-2222-2222-222222222222",
      role: "owner",
    });

    await expect(verifyPasswordResetToken(sessionToken)).rejects.toThrow();
  });
});
