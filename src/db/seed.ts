import { db } from "@/db";
import { organizations, users, gatewayAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createSession } from "@/lib/session";
import { hashPassword } from "@/lib/password";

async function seed() {
  const [existingOrg] = await db.select().from(organizations).where(eq(organizations.name, "Arena Martins"));
  const org = existingOrg ?? (await db.insert(organizations).values({ name: "Arena Martins" }).returning())[0];

  const handle = process.env.INFINITEPAY_HANDLE ?? "handle-dev-placeholder";
  const [existingGatewayAccount] = await db
    .select()
    .from(gatewayAccounts)
    .where(and(eq(gatewayAccounts.organizationId, org.id), eq(gatewayAccounts.provider, "infinitepay")));

  const gatewayAccount = existingGatewayAccount
    ? (
        await db
          .update(gatewayAccounts)
          .set({ externalAccountId: handle, status: "active" })
          .where(eq(gatewayAccounts.id, existingGatewayAccount.id))
          .returning()
      )[0]
    : (
        await db
          .insert(gatewayAccounts)
          .values({ organizationId: org.id, provider: "infinitepay", externalAccountId: handle, status: "active" })
          .returning()
      )[0];

  const plainPassword = process.env.SEED_USER_PASSWORD ?? "trocar-esta-senha";
  const passwordHash = await hashPassword(plainPassword);

  const [existingUser] = await db.select().from(users).where(eq(users.email, "lucas@arenamartins.com.br"));
  const user = existingUser
    ? (
        await db
          .update(users)
          .set({ passwordHash })
          .where(eq(users.id, existingUser.id))
          .returning()
      )[0]
    : (
        await db
          .insert(users)
          .values({
            organizationId: org.id,
            name: "Lucas Martins",
            email: "lucas@arenamartins.com.br",
            passwordHash,
            role: "owner",
          })
          .returning()
      )[0];

  const token = await createSession({
    userId: user.id,
    organizationId: org.id,
    role: "owner",
  });

  console.log("Organization ID:", org.id);
  console.log("User ID:", user.id);
  console.log("Gateway account (InfinitePay) ID:", gatewayAccount.id);
  console.log("Gateway account handle:", gatewayAccount.externalAccountId);
  console.log("Login:", user.email);
  console.log("Senha:", plainPassword);
  console.log("Cookie groupay_session (opcional, para testes via curl):", token);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
