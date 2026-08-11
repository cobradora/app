import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { createSession } from "@/lib/session";

async function seed() {
  const [org] = await db
    .insert(organizations)
    .values({ name: "Arena Martins" })
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
  console.log("Cookie groupay_session:", token);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
