import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password", () => {
  it("verifica a senha correta contra o hash gerado", async () => {
    const hash = await hashPassword("minha-senha-123");
    await expect(verifyPassword("minha-senha-123", hash)).resolves.toBe(true);
  });

  it("rejeita uma senha incorreta", async () => {
    const hash = await hashPassword("minha-senha-123");
    await expect(verifyPassword("senha-errada", hash)).resolves.toBe(false);
  });

  it("gera hashes diferentes (salt aleatorio) para a mesma senha", async () => {
    const hash1 = await hashPassword("mesma-senha");
    const hash2 = await hashPassword("mesma-senha");
    expect(hash1).not.toBe(hash2);
  });

  it("rejeita um hash malformado sem lançar erro", async () => {
    await expect(verifyPassword("qualquer", "hash-sem-separador")).resolves.toBe(false);
  });
});
