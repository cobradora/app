import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups } from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { listPendingChargesByPhone } from "@/services/pending-charges";
import { truncateAll } from "../helpers/db";

describe("pending charges", () => {
  let organizationId: string;
  let groupPublicSlug: string;

  beforeEach(async () => {
    await truncateAll();
    const [org] = await db.insert(organizations).values({ name: "Org Teste" }).returning();
    organizationId = org.id;
    const [group] = await db
      .insert(groups)
      .values({ organizationId, name: "Futebol", publicSlug: "futebol-abcd", billingDay: 10, defaultAmount: 9000 })
      .returning();
    groupPublicSlug = group.publicSlug;

    const responsible = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0009", "Maria");
    const dependent = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0009", "Pedro");
    await linkParticipantToGroup(organizationId, group.id, responsible.id, new Date("2026-06-01T12:00:00Z"));
    await linkParticipantToGroup(organizationId, group.id, dependent.id, new Date("2026-06-01T12:00:00Z"));

    await generateBillingPeriod(organizationId, group.id, "2026-07");
    await generateBillingPeriod(organizationId, group.id, "2026-08");
  });

  it("retorna julho e agosto pendentes juntos, nao apenas o mais recente", async () => {
    const pending = await listPendingChargesByPhone(groupPublicSlug, "(11) 90000-0009");

    expect(pending).toHaveLength(4);
    const months = pending.map((c) => c.referenceMonth).sort();
    expect(months).toEqual(["2026-07", "2026-07", "2026-08", "2026-08"]);
    expect(new Set(pending.map((c) => c.participantName))).toEqual(new Set(["Maria", "Pedro"]));
    expect(new Set(pending.map((c) => c.payerName))).toEqual(new Set(["Maria"]));
  });
});
