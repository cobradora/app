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

    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0009");
    await linkParticipantToGroup(group.id, participant.id);

    await generateBillingPeriod(group.id, "2026-07");
    await generateBillingPeriod(group.id, "2026-08");
  });

  it("retorna julho e agosto pendentes juntos, nao apenas o mais recente", async () => {
    const pending = await listPendingChargesByPhone(groupPublicSlug, "(11) 90000-0009");

    expect(pending).toHaveLength(2);
    const months = pending.map((c) => c.referenceMonth).sort();
    expect(months).toEqual(["2026-07", "2026-08"]);
  });
});
