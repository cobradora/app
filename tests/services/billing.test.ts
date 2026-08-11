import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, charges, billingPeriods } from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

describe("billing service", () => {
  let organizationId: string;
  let groupId: string;

  beforeEach(async () => {
    await truncateAll();
    const [org] = await db.insert(organizations).values({ name: "Org Teste" }).returning();
    organizationId = org.id;
    const [group] = await db
      .insert(groups)
      .values({ organizationId, name: "Vôlei", publicSlug: "volei-abcd", billingDay: 5, defaultAmount: 8000 })
      .returning();
    groupId = group.id;

    const p1 = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0001");
    const p2 = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0002");
    await linkParticipantToGroup(groupId, p1.id);
    await linkParticipantToGroup(groupId, p2.id);
  });

  it("cria uma cobranca por participante ativo, copiando o valor do grupo", async () => {
    const period = await generateBillingPeriod(groupId, "2026-08");

    const rows = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((c) => c.totalAmount === 8000)).toBe(true);
    expect(rows.every((c) => c.originalAmount === 8000)).toBe(true);
  });

  it("mudar a mensalidade do grupo depois nao altera competencia ja gerada (RB-004)", async () => {
    const period = await generateBillingPeriod(groupId, "2026-08");
    await db.update(groups).set({ defaultAmount: 12000 }).where(eq(groups.id, groupId));

    const rows = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    expect(rows.every((c) => c.totalAmount === 8000)).toBe(true);
  });

  it("nao permite gerar a mesma competencia duas vezes", async () => {
    await generateBillingPeriod(groupId, "2026-08");
    await expect(generateBillingPeriod(groupId, "2026-08")).rejects.toThrow();

    const periods = await db.select().from(billingPeriods).where(eq(billingPeriods.groupId, groupId));
    expect(periods).toHaveLength(1);
  });
});
