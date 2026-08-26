import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { getInfinitePayAccount, setInfinitePayHandle } from "@/services/gateway-accounts";
import { truncateAll } from "../helpers/db";

describe("gateway-accounts service", () => {
  let organizationId: string;

  beforeEach(async () => {
    await truncateAll();
    const [org] = await db.insert(organizations).values({ name: "Org Teste" }).returning();
    organizationId = org.id;
  });

  it("retorna null quando a organizacao ainda nao tem conta InfinitePay", async () => {
    const account = await getInfinitePayAccount(organizationId);
    expect(account).toBeNull();
  });

  it("cria a conta InfinitePay na primeira vez", async () => {
    const account = await setInfinitePayHandle(organizationId, { handle: "minha-conta" });

    expect(account.externalAccountId).toBe("minha-conta");
    expect(account.provider).toBe("infinitepay");
    expect(account.status).toBe("active");

    const found = await getInfinitePayAccount(organizationId);
    expect(found?.id).toBe(account.id);
  });

  it("atualiza a mesma linha em vez de duplicar quando chamado de novo", async () => {
    const first = await setInfinitePayHandle(organizationId, { handle: "conta-antiga" });
    const second = await setInfinitePayHandle(organizationId, { handle: "conta-nova" });

    expect(second.id).toBe(first.id);
    expect(second.externalAccountId).toBe("conta-nova");
  });

  it("rejeita handle com o caractere $", async () => {
    await expect(setInfinitePayHandle(organizationId, { handle: "$minha-conta" })).rejects.toThrow();
  });

  it("aplica as regras públicas de formato da InfiniteTag", async () => {
    await expect(setInfinitePayHandle(organizationId, { handle: "1conta" })).rejects.toThrow();
    await expect(setInfinitePayHandle(organizationId, { handle: "minha conta" })).rejects.toThrow();
    await expect(setInfinitePayHandle(organizationId, { handle: "minha_conta_extra" })).rejects.toThrow();
    await expect(setInfinitePayHandle(organizationId, { handle: `a${"b".repeat(24)}` })).rejects.toThrow();

    const account = await setInfinitePayHandle(organizationId, { handle: "Minha_conta-24" });
    expect(account.externalAccountId).toBe("Minha_conta-24");
  });
});
