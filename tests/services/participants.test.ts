import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, groupParticipants } from "@/db/schema";
import {
  findOrCreateParticipantByPhone,
  linkParticipantToGroup,
  unlinkParticipantFromGroup,
  updateParticipant,
  listGroupParticipants,
} from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
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

  it("atualiza nome e telefone, recalculando phoneNormalized", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");

    const updated = await updateParticipant(organizationId, participant.id, {
      name: "Marina Costa",
      phone: "(11) 91234-5678",
    });

    expect(updated?.name).toBe("Marina Costa");
    expect(updated?.phoneNormalized).toBe("+5511912345678");

    const foundByNewPhone = await findOrCreateParticipantByPhone(organizationId, "(11) 91234-5678");
    expect(foundByNewPhone.id).toBe(participant.id);
  });

  it("nao atualiza participante de outra organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();
    const participant = await findOrCreateParticipantByPhone(otherOrg.id, "(11) 98812-4410");

    const result = await updateParticipant(organizationId, participant.id, { name: "Tentativa", phone: "(11) 90000-0000" });

    expect(result).toBeNull();
  });

  it("bloqueia remocao do participante do grupo se houver cobranca em aberto", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(groupId, participant.id);
    await generateBillingPeriod(groupId, "2026-08");

    await expect(unlinkParticipantFromGroup(groupId, participant.id)).rejects.toThrow("cobranças em aberto");

    const [link] = await db
      .select()
      .from(groupParticipants)
      .where(eq(groupParticipants.participantId, participant.id));
    expect(link.status).toBe("active");
  });

  it("permite remover do grupo quando nao ha cobranca em aberto", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(groupId, participant.id);

    await unlinkParticipantFromGroup(groupId, participant.id);

    const [link] = await db
      .select()
      .from(groupParticipants)
      .where(eq(groupParticipants.participantId, participant.id));
    expect(link.status).toBe("left");
  });

  it("lista apenas participantes com vinculo ativo no grupo", async () => {
    const active = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(groupId, active.id);
    const left = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0002");
    await linkParticipantToGroup(groupId, left.id);
    await unlinkParticipantFromGroup(groupId, left.id);

    const rows = await listGroupParticipants(organizationId, groupId);

    expect(rows).toHaveLength(1);
    expect(rows![0].participantId).toBe(active.id);
  });

  it("listGroupParticipants retorna null quando o grupo nao pertence a organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();

    const rows = await listGroupParticipants(otherOrg.id, groupId);

    expect(rows).toBeNull();
  });
});
