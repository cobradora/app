import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, participants, charges } from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { listGroupCharges, listOrganizationCharges, cancelCharge } from "@/services/charges";
import { randomUUID } from "node:crypto";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

describe("charges service", () => {
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

  it("lista cobrancas de todos os periodos do grupo, com nome do participante", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await db.update(participants).set({ name: "Marina Costa" }).where(eq(participants.id, participant.id));
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-07-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, groupId, "2026-07");
    await generateBillingPeriod(organizationId, groupId, "2026-08");

    const rows = await listGroupCharges(organizationId, groupId);

    expect(rows).toHaveLength(2);
    const months = rows!.map((r) => r.referenceMonth).sort();
    expect(months).toEqual(["2026-07", "2026-08"]);
    expect(rows!.every((r) => r.participantName === "Marina Costa")).toBe(true);
    expect(rows!.every((r) => r.status === "open")).toBe(true);
  });

  it("retorna null quando o grupo nao pertence a organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();

    const rows = await listGroupCharges(otherOrg.id, groupId);

    expect(rows).toBeNull();
  });

  it("retorna lista vazia quando o grupo existe mas nao tem cobrancas geradas", async () => {
    const rows = await listGroupCharges(organizationId, groupId);
    expect(rows).toEqual([]);
  });

  it("lista cobrancas de todos os grupos da organizacao para um mes especifico", async () => {
    const [otherGroup] = await db
      .insert(groups)
      .values({ organizationId, name: "Futebol", publicSlug: "futebol-abcd", billingDay: 5, defaultAmount: 9000 })
      .returning();

    const participant1 = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, groupId, participant1.id, new Date("2026-07-01T12:00:00Z"));
    const participant2 = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0002");
    await linkParticipantToGroup(organizationId, otherGroup.id, participant2.id, new Date("2026-07-01T12:00:00Z"));

    await generateBillingPeriod(organizationId, groupId, "2026-08");
    await generateBillingPeriod(organizationId, otherGroup.id, "2026-08");
    await generateBillingPeriod(organizationId, groupId, "2026-07");

    const rows = await listOrganizationCharges(organizationId, "2026-08");

    expect(rows).toHaveLength(2);
    const groupNames = rows.map((r) => r.groupName).sort();
    expect(groupNames).toEqual(["Futebol", "Vôlei"]);
    expect(rows.every((r) => r.referenceMonth === "2026-08")).toBe(true);
  });

  it("nao mistura cobrancas de outra organizacao no mesmo mes", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();
    const [otherGroup] = await db
      .insert(groups)
      .values({ organizationId: otherOrg.id, name: "Grupo de outra org", publicSlug: "outra-org-abcd", billingDay: 5, defaultAmount: 5000 })
      .returning();
    const otherParticipant = await findOrCreateParticipantByPhone(otherOrg.id, "(11) 90000-0003");
    await linkParticipantToGroup(otherOrg.id, otherGroup.id, otherParticipant.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(otherOrg.id, otherGroup.id, "2026-08");

    const rows = await listOrganizationCharges(organizationId, "2026-08");

    expect(rows).toEqual([]);
  });

  it("cancela uma cobranca em aberto", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const [charge] = await db.select().from(charges).where(eq(charges.participantId, participant.id));

    await cancelCharge(organizationId, randomUUID(), charge.id);

    const [updated] = await db.select().from(charges).where(eq(charges.id, charge.id));
    expect(updated.status).toBe("canceled");
  });

  it("nao cancela cobranca que ja nao esta mais aberta", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const [charge] = await db.select().from(charges).where(eq(charges.participantId, participant.id));
    await db.update(charges).set({ status: "paid" }).where(eq(charges.id, charge.id));

    await expect(cancelCharge(organizationId, randomUUID(), charge.id)).rejects.toThrow();

    const [unchanged] = await db.select().from(charges).where(eq(charges.id, charge.id));
    expect(unchanged.status).toBe("paid");
  });
});
