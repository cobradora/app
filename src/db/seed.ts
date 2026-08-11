import { db } from "@/db";
import { organizations, users, gatewayAccounts } from "@/db/schema";
import { createSession } from "@/lib/session";

async function seed() {
  const [org] = await db
    .insert(organizations)
    .values({ name: "Arena Martins" })
    .returning();

  const [gatewayAccount] = await db
    .insert(gatewayAccounts)
    .values({
      organizationId: org.id,
      provider: "infinitepay",
      externalAccountId: process.env.INFINITEPAY_DEV_HANDLE ?? "handle-dev-placeholder",
      status: "active",
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      organizationId: org.id,
      name: "Lucas Martins",
      email: "lucas@arenamartins.com.br",
      role: "owner",
    })
    .returning();

  const token = await createSession({
    userId: user.id,
    organizationId: org.id,
    role: "owner",
  });

  console.log("Organization ID:", org.id);
  console.log("User ID:", user.id);
  console.log("Gateway account (InfinitePay) ID:", gatewayAccount.id);
  console.log("Gateway account handle:", gatewayAccount.externalAccountId);
  console.log("Cookie groupay_session:", token);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
