import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, charges } from "@/db/schema";
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
      .values({ organizationId, name: "Vôlei", publicSlug: "volei-abcd", billingDay: 10, defaultAmount: 8000 })
      .returning();
    groupId = group.id;
  });

  it("gera uma charge por participante ativo do grupo", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(groupId, participant.id);

    const period = await generateBillingPeriod(groupId, "2026-08");

    const rows = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].participantId).toBe(participant.id);
    expect(rows[0].status).toBe("open");
    expect(rows[0].totalAmount).toBe(8000);
  });

  it("bloqueia gerar cobrança duas vezes para o mesmo mês, com mensagem clara", async () => {
    await generateBillingPeriod(groupId, "2026-08");

    await expect(generateBillingPeriod(groupId, "2026-08")).rejects.toThrow("Já existe uma cobrança gerada para este mês");
  });

  it("permite gerar cobrança para meses diferentes do mesmo grupo", async () => {
    await generateBillingPeriod(groupId, "2026-08");
    const second = await generateBillingPeriod(groupId, "2026-09");
    expect(second.referenceMonth).toBe("2026-09");
  });
});
