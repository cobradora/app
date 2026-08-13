import { describe, it, expect, beforeEach } from "vitest";
import { signUp } from "@/services/auth";
import { verifyPassword } from "@/lib/password";
import { truncateAll } from "../helpers/db";

describe("auth service", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("cria organizacao e usuario owner, com senha hasheada", async () => {
    const result = await signUp({
      organizationName: "Arena Nova",
      name: "Lucas Martins",
      email: "lucas@arenanova.com.br",
      password: "senha-forte-123",
    });

    expect(result).not.toBeNull();
    expect(result!.organization.name).toBe("Arena Nova");
    expect(result!.user.email).toBe("lucas@arenanova.com.br");
    expect(result!.user.role).toBe("owner");
    expect(result!.user.organizationId).toBe(result!.organization.id);
    expect(result!.user.passwordHash).not.toBe("senha-forte-123");

    const ok = await verifyPassword("senha-forte-123", result!.user.passwordHash!);
    expect(ok).toBe(true);
  });

  it("rejeita cadastro com email ja usado, retornando null", async () => {
    await signUp({
      organizationName: "Arena Nova",
      name: "Lucas Martins",
      email: "lucas@arenanova.com.br",
      password: "senha-forte-123",
    });

    const second = await signUp({
      organizationName: "Outra Arena",
      name: "Outra Pessoa",
      email: "lucas@arenanova.com.br",
      password: "outra-senha-123",
    });

    expect(second).toBeNull();
  });
});
