import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/password";
import { parsePhoneBR, PHONE_INPUT_MAX_LENGTH } from "@/lib/phone";

function isValidOrganizerPhone(value: string): boolean {
  try {
    parsePhoneBR(value);
    return true;
  } catch {
    return false;
  }
}

export const signUpInput = z
  .object({
    organizationName: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    email: z.string().email(),
    password: z.string().min(8).max(200),
    billingModule: z.enum(["dora", "cobradora"]).default("dora"),
    organizerPhone: z
      .string()
      .max(PHONE_INPUT_MAX_LENGTH)
      .refine(isValidOrganizerPhone, "Informe um celular brasileiro válido com DDD")
      .nullable()
      .optional(),
  })
  .superRefine((input, context) => {
    if (input.billingModule === "cobradora" && !input.organizerPhone) {
      context.addIssue({
        code: "custom",
        path: ["organizerPhone"],
        message: "Informe o WhatsApp do organizador para usar o módulo CobraDora",
      });
    }
  });

export type SignUpInput = z.input<typeof signUpInput>;

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
  const organizerPhone = input.organizerPhone ? parsePhoneBR(input.organizerPhone) : null;

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({
        name: input.organizationName,
        billingModule: input.billingModule,
        organizerPhoneNormalized: organizerPhone?.normalized ?? null,
        organizerPhoneDisplay: organizerPhone?.display ?? null,
      })
      .returning();
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

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("Senha atual incorreta");
    this.name = "InvalidCurrentPasswordError";
  }
}

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

export async function changePassword(userId: string, rawInput: ChangePasswordInput) {
  const input = changePasswordInput.parse(rawInput);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new InvalidCurrentPasswordError();
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/**
 * Sempre retorna sem lançar, exista ou não o e-mail — o chamador (rota)
 * decide se dispara o e-mail de reset, mas nunca revela ao cliente se a
 * conta existe.
 */
export async function findUserByEmailForPasswordReset(email: string) {
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email));
  return user ?? null;
}

export async function resetPasswordWithToken(userId: string, newPassword: string) {
  const passwordHash = await hashPassword(z.string().min(8).max(200).parse(newPassword));
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}
