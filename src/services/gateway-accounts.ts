import { db } from "@/db";
import { gatewayAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const setInfinitePayHandleInput = z.object({
  handle: z
    .string()
    .trim()
    .min(1)
    .max(24, "A InfiniteTag deve ter no máximo 24 caracteres")
    .regex(
      /^[A-Za-z][A-Za-z0-9_-]*$/,
      "A InfiniteTag deve começar com uma letra e conter somente letras, números, hífen ou underline",
    )
    .refine((value) => (value.match(/_/g) ?? []).length <= 1, {
      message: "A InfiniteTag pode conter no máximo um underline",
    }),
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
 * Cria ou atualiza a configuração InfinitePay da organização. A unique
 * constraint organizationId+provider garante no máximo uma linha por
 * provedor. `active` significa "habilitada para tentar criar checkouts"; a
 * API pública da InfinitePay não oferece prova de titularidade da tag, então
 * a interface deve apresentá-la como cadastrada, não como verificada.
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
