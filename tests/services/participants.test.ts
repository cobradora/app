import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, groupParticipants } from "@/db/schema";
import {
  findOrCreateParticipantByPhone,
  linkParticipantToGroup,
  unlinkParticipantFromGroup,
} from "@/services/participants";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

describe("participants service", () => {
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
  });

  it("gera um id proprio, independente do telefone", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    expect(participant.id).not.toContain("98812");
    expect(participant.phoneNormalized).toBe("+5511988124410");
  });

  it("reaproveita o participante existente pelo mesmo telefone", async () => {
    const first = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    const second = await findOrCreateParticipantByPhone(organizationId, "11988124410");
    expect(second.id).toBe(first.id);
  });

  it("sair do grupo preserva o vinculo antigo e permite reentrada (RB-018)", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(groupId, participant.id);
    await unlinkParticipantFromGroup(groupId, participant.id);
    await linkParticipantToGroup(groupId, participant.id);

    const links = await db
      .select()
      .from(groupParticipants)
      .where(eq(groupParticipants.participantId, participant.id));

    expect(links).toHaveLength(2);
    expect(links[0].status).toBe("left");
    expect(links[0].leftAt).not.toBeNull();
    expect(links[1].status).toBe("active");
  });
});
