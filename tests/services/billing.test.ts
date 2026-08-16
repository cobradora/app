import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { organizations, groups, charges } from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod, generateDueBillingPeriods, renewGroupCycleManually, GroupCycleNotManualError } from "@/services/billing";
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
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-09T12:00:00Z"));

    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");

    const rows = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].participantId).toBe(participant.id);
    expect(rows[0].status).toBe("open");
    expect(rows[0].totalAmount).toBe(8000);
  });

  it("bloqueia gerar cobrança duas vezes para o mesmo mês, com mensagem clara", async () => {
    await generateBillingPeriod(organizationId, groupId, "2026-08");

    const repeated = await generateBillingPeriod(organizationId, groupId, "2026-08");
    expect(repeated.referenceMonth).toBe("2026-08");
  });

  it("permite gerar cobrança para meses diferentes do mesmo grupo", async () => {
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const second = await generateBillingPeriod(organizationId, groupId, "2026-09");
    expect(second.referenceMonth).toBe("2026-09");
  });

  it("isola a falha de um grupo no Cron e continua os demais sem expor a mensagem", async () => {
    const [secondGroup] = await db
      .insert(groups)
      .values({
        organizationId,
        name: "Basquete",
        publicSlug: "basquete-abcd",
        billingDay: 10,
        defaultAmount: 9000,
      })
      .returning();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await generateDueBillingPeriods(
        new Date("2026-08-10T12:00:00-03:00"),
        async (_organizationId, targetGroupId) => {
          if (targetGroupId === groupId) throw new Error("segredo-que-nao-pode-vazar");
        },
      );

      expect(result.generated).toEqual([
        { groupId: secondGroup.id, referenceMonth: "2026-08" },
      ]);
      expect(result.failures).toEqual([
        { groupId, referenceMonth: "2026-08", code: "generation_failed" },
      ]);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("segredo-que-nao-pode-vazar");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("renova o ciclo manualmente para grupo sem billingDay, usando a data de hoje como vencimento", async () => {
    const [manualGroup] = await db
      .insert(groups)
      .values({ organizationId, name: "Manual", publicSlug: "manual-abcd", billingDay: null, defaultAmount: 5000 })
      .returning();
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, manualGroup.id, participant.id, new Date("2026-08-01T12:00:00Z"));

    const period = await renewGroupCycleManually(organizationId, manualGroup.id, new Date("2026-08-15T12:00:00-03:00"));

    expect(period).not.toBeNull();
    expect(period!.dueDate).toBe("2026-08-15");
    const rows = await db.select().from(charges).where(eq(charges.billingPeriodId, period!.id));
    expect(rows).toHaveLength(1);
  });

  it("clicar em renovar de novo no mesmo mês completa cobrança pra participante adicionado depois, sem duplicar quem já foi cobrado", async () => {
    const [manualGroup] = await db
      .insert(groups)
      .values({ organizationId, name: "Manual", publicSlug: "manual-efgh", billingDay: null, defaultAmount: 5000 })
      .returning();
    const first = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, manualGroup.id, first.id, new Date("2026-08-01T12:00:00Z"));

    const firstRenew = await renewGroupCycleManually(organizationId, manualGroup.id, new Date("2026-08-05T12:00:00-03:00"));

    const second = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4411");
    await linkParticipantToGroup(organizationId, manualGroup.id, second.id, new Date("2026-08-06T12:00:00Z"));

    const secondRenew = await renewGroupCycleManually(organizationId, manualGroup.id, new Date("2026-08-15T12:00:00-03:00"));

    expect(secondRenew!.id).toBe(firstRenew!.id);
    const rows = await db.select().from(charges).where(eq(charges.billingPeriodId, secondRenew!.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.participantId).sort()).toEqual([first.id, second.id].sort());
  });

  it("recusa renovação manual para grupo com billingDay configurado", async () => {
    await expect(renewGroupCycleManually(organizationId, groupId, new Date())).rejects.toThrow(GroupCycleNotManualError);
  });

  it("generateDueBillingPeriods pula grupos em modo manual (billingDay nulo)", async () => {
    const [manualGroup] = await db
      .insert(groups)
      .values({ organizationId, name: "Manual", publicSlug: "manual-xyz", billingDay: null, defaultAmount: 5000 })
      .returning();

    const result = await generateDueBillingPeriods(new Date("2026-08-10T12:00:00-03:00"), generateBillingPeriod);

    expect(result.generated.some((item) => item.groupId === manualGroup.id)).toBe(false);
    expect(result.failures.some((item) => item.groupId === manualGroup.id)).toBe(false);
  });
});
