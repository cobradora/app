import { db } from "@/db";
import { gatewayAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const setInfinitePayHandleInput = z.object({
  handle: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => !v.startsWith("$"), { message: "Informe o InfiniteTag sem o caractere $" }),
});

export type SetInfinitePayHandleInput = z.infer<typeof setInfinitePayHandleInput>;

export async function getInfinitePayAccount(organizationId: string) {
  const [account] = await db
    .select()
    .from(gatewayAccounts)
    .where(and(eq(gatewayAccounts.organizationId, organizationId), eq(gatewayAccounts.provider, "infinitepay")));
  return account ?? null;
}

/**
 * Cria ou atualiza a conta InfinitePay da organizacao (find-or-update por
 * organizationId+provider — nao ha unique constraint no banco para isso,
 * entao o service e' quem garante no maximo uma linha "infinitepay" por
 * organizacao). Sempre marca `status: "active"`, ja que informar o handle
 * pela tela de Configuracoes e' o proprio ato de habilitar o checkout.
 */
export async function setInfinitePayHandle(organizationId: string, rawInput: SetInfinitePayHandleInput) {
  const input = setInfinitePayHandleInput.parse(rawInput);
  const [account] = await db
    .insert(gatewayAccounts)
    .values({ organizationId, provider: "infinitepay", externalAccountId: input.handle, status: "active" })
    .onConflictDoUpdate({
      target: [gatewayAccounts.organizationId, gatewayAccounts.provider],
      set: { externalAccountId: input.handle, status: "active" },
    })
    .returning();
  return account;
}
