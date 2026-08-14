import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "@/lib/password";

export const signUpInput = z.object({
  organizationName: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export type SignUpInput = z.infer<typeof signUpInput>;

/**
 * Cria a organizacao e o primeiro usuario (owner) de uma vez, para o
 * cadastro publico. Retorna `null` (em vez de lancar) quando o email ja
 * esta em uso, para o caller devolver uma mensagem clara sem crashar.
 */
export async function signUp(rawInput: SignUpInput) {
  const input = signUpInput.parse(rawInput);

  const [existing] = await db.select().from(users).where(eq(users.email, input.email));
  if (existing) return null;

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [organization] = await tx.insert(organizations).values({ name: input.organizationName }).returning();
    const [user] = await tx
      .insert(users)
      .values({
        organizationId: organization.id,
        name: input.name,
        email: input.email,
        passwordHash,
        role: "owner",
      })
      .returning();

    return { organization, user };
  });
}

export async function getUserById(userId: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  return user ?? null;
}
