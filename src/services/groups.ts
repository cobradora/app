import { db } from "@/db";
import { groups } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const createGroupInput = z.object({
  name: z.string().min(1).max(200),
  sport: z.string().min(1).max(60).optional(),
  billingDay: z.number().int().min(1).max(28),
  defaultAmount: z.number().int().positive(),
});

export type CreateGroupInput = z.infer<typeof createGroupInput>;

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createGroup(organizationId: string, rawInput: CreateGroupInput) {
  const input = createGroupInput.parse(rawInput);
  const baseSlug = slugify(input.name);
  const suffix = Math.random().toString(36).slice(2, 6);

  const [group] = await db
    .insert(groups)
    .values({
      organizationId,
      name: input.name,
      publicSlug: `${baseSlug}-${suffix}`,
      billingDay: input.billingDay,
      defaultAmount: input.defaultAmount,
    })
    .returning();

  return group;
}

export async function listGroups(organizationId: string) {
  return db.select().from(groups).where(eq(groups.organizationId, organizationId));
}
