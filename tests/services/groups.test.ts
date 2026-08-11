import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { createGroup, listGroups } from "@/services/groups";
import { truncateAll } from "../helpers/db";

describe("groups service", () => {
  let organizationId: string;

  beforeEach(async () => {
    await truncateAll();
    const [org] = await db.insert(organizations).values({ name: "Org Teste" }).returning();
    organizationId = org.id;
  });

  it("cria um grupo com slug publico gerado a partir do nome", async () => {
    const group = await createGroup(organizationId, {
      name: "Vôlei de quarta",
      sport: "Vôlei",
      billingDay: 5,
      defaultAmount: 8000,
    });

    expect(group.publicSlug).toMatch(/^volei-de-quarta(-[a-z0-9]{4})?$/);
    expect(group.defaultAmount).toBe(8000);
    expect(group.organizationId).toBe(organizationId);
  });

  it("nao retorna grupos de outra organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();
    await createGroup(organizationId, { name: "Grupo A", sport: "Futebol", billingDay: 10, defaultAmount: 9000 });
    await createGroup(otherOrg.id, { name: "Grupo B", sport: "Futebol", billingDay: 10, defaultAmount: 9000 });

    const result = await listGroups(organizationId);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Grupo A");
  });
});
