import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import {
  charges,
  organizations,
  participants as participantRows,
  groups,
  groupParticipants,
  checkoutSessions,
  checkoutItems,
  financialContacts,
} from "@/db/schema";
import {
  addParticipantToGroup,
  findOrCreateParticipantByPhone,
  linkParticipantToGroup,
  unlinkParticipantFromGroup,
  updateParticipant,
  updateGroupParticipantTag,
  listGroupParticipants,
  ParticipantNameConflictError,
  ParticipantCheckoutInProgressError,
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

  it("mantem devedores separados e compartilha o contato financeiro pelo telefone", async () => {
    const first = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    const second = await findOrCreateParticipantByPhone(organizationId, "11988124410");
    expect(second.id).not.toBe(first.id);
    expect(second.financialContactId).toBe(first.financialContactId);
    expect(first.financialRole).toBe("responsible");
    expect(second.financialRole).toBe("dependent");
  });

  it("cadastra telefone de outro país no formato internacional", async () => {
    const participant = await findOrCreateParticipantByPhone(
      organizationId,
      "+351 912 345 678",
      "Participante português",
    );

    expect(participant.phoneNormalized).toBe("+351912345678");
    expect(participant.phoneDisplay).toBe("+351912345678");
  });

  it("preserva o histórico de oposição ao registrar um novo opt-in no mesmo contato", async () => {
    const participant = await addParticipantToGroup(
      organizationId,
      groupId,
      { name: "Marina Costa", phone: "(11) 98812-4410", whatsappConsent: true },
      new Date("2026-08-01T12:00:00Z"),
    );
    await updateParticipant(organizationId, participant!.participant.id, {
      name: "Marina Costa",
      phone: "(11) 98812-4410",
      whatsappConsent: false,
    });
    const [opposed] = await db
      .select()
      .from(financialContacts)
      .where(eq(financialContacts.id, participant!.participant.financialContactId));
    expect(opposed.whatsappOptInAt).not.toBeNull();
    expect(opposed.whatsappOptOutAt).not.toBeNull();
    const oppositionAt = opposed.whatsappOptOutAt;

    await updateParticipant(organizationId, participant!.participant.id, {
      name: "Marina Costa",
      phone: "(11) 98812-4410",
      whatsappConsent: true,
    });
    const [reconsented] = await db
      .select()
      .from(financialContacts)
      .where(eq(financialContacts.id, participant!.participant.financialContactId));

    expect(reconsented.whatsappOptOutAt).toEqual(oppositionAt);
    expect(reconsented.whatsappOptInAt!.getTime()).toBeGreaterThan(oppositionAt!.getTime());
  });

  it("sair do grupo preserva o vinculo antigo e permite reentrada (RB-018)", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    await unlinkParticipantFromGroup(organizationId, groupId, participant.id);
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));

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

    const dependent = await findOrCreateParticipantByPhone(organizationId, "(11) 91234-5678", "Dependente");
    expect(dependent.id).not.toBe(participant.id);
    expect(dependent.financialContactId).toBe(updated?.financialContactId);
    expect(dependent.financialRole).toBe("dependent");
  });

  it("bloqueia troca de telefone enquanto o contato possui checkout created/pending relevante", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Responsável");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const [charge] = await db.select().from(charges).where(eq(charges.participantId, participant.id));
    await db.update(charges).set({ status: "checkout_pending" }).where(eq(charges.id, charge.id));
    const [session] = await db
      .insert(checkoutSessions)
      .values({
        organizationId,
        participantId: participant.id,
        financialContactId: participant.financialContactId,
        gateway: "infinitepay",
        status: "pending",
        externalCreationState: "linked",
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: "participant-phone-lock",
      })
      .returning();
    await db.insert(checkoutItems).values({
      checkoutSessionId: session.id,
      chargeId: charge.id,
      amount: charge.totalAmount,
    });

    await expect(
      updateParticipant(organizationId, participant.id, {
        name: "Responsável",
        phone: "(11) 97777-1234",
      }),
    ).rejects.toBeInstanceOf(ParticipantCheckoutInProgressError);

    const [unchanged] = await db.select().from(participantRows).where(eq(participantRows.id, participant.id));
    expect(unchanged.financialContactId).toBe(participant.financialContactId);
  });

  it("permite alterar apenas o nome sem romper contato de checkout ativo", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Nome Antigo");
    await db.insert(checkoutSessions).values({
      organizationId,
      participantId: participant.id,
      financialContactId: participant.financialContactId,
      gateway: "infinitepay",
      status: "created",
      externalCreationState: "ambiguous",
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: "participant-name-allowed",
    });

    const updated = await updateParticipant(organizationId, participant.id, {
      name: "Nome Novo",
      phone: "(11) 98812-4410",
    });
    expect(updated?.name).toBe("Nome Novo");
    expect(updated?.financialContactId).toBe(participant.financialContactId);
  });

  it("nao atualiza participante de outra organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();
    const participant = await findOrCreateParticipantByPhone(otherOrg.id, "(11) 98812-4410");

    const result = await updateParticipant(organizationId, participant.id, { name: "Tentativa", phone: "(11) 90000-0000" });

    expect(result).toBeNull();
  });

  it("bloqueia remocao do participante do grupo se houver cobranca em aberto", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, groupId, "2026-08");

    await expect(unlinkParticipantFromGroup(organizationId, groupId, participant.id)).rejects.toThrow("cobranças em aberto");

    const [link] = await db
      .select()
      .from(groupParticipants)
      .where(eq(groupParticipants.participantId, participant.id));
    expect(link.status).toBe("active");
  });

  it("permite remover do grupo quando nao ha cobranca em aberto", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));

    await unlinkParticipantFromGroup(organizationId, groupId, participant.id);

    const [link] = await db
      .select()
      .from(groupParticipants)
      .where(eq(groupParticipants.participantId, participant.id));
    expect(link.status).toBe("left");
  });

  it("lista apenas participantes com vinculo ativo no grupo", async () => {
    const active = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, groupId, active.id, new Date("2026-08-01T12:00:00Z"));
    const left = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0002");
    await linkParticipantToGroup(organizationId, groupId, left.id, new Date("2026-08-01T12:00:00Z"));
    await unlinkParticipantFromGroup(organizationId, groupId, left.id);

    const result = await listGroupParticipants(organizationId, groupId);

    expect(result!.participants).toHaveLength(1);
    expect(result!.participants[0].participantId).toBe(active.id);
  });

  it("listGroupParticipants retorna null quando o grupo nao pertence a organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();

    const result = await listGroupParticipants(otherOrg.id, groupId);

    expect(result).toBeNull();
  });

  it("proibe nomes equivalentes por acento, caixa e espacos no mesmo grupo", async () => {
    await addParticipantToGroup(
      organizationId,
      groupId,
      { name: "  José   Silva ", phone: "(11) 98888-0001" },
      new Date("2026-08-01T12:00:00Z"),
    );

    await expect(
      addParticipantToGroup(
        organizationId,
        groupId,
        { name: "jose silva", phone: "(11) 98888-0002" },
        new Date("2026-08-01T12:00:00Z"),
      ),
    ).rejects.toBeInstanceOf(ParticipantNameConflictError);
  });

  it("cadastro no proprio dia da renovacao comeca somente no ciclo seguinte", async () => {
    const added = await addParticipantToGroup(
      organizationId,
      groupId,
      { name: "Ciclo seguinte", phone: "(11) 98888-0003" },
      new Date("2026-08-05T12:00:00Z"),
    );

    expect(added?.startsNextCycle).toBe(true);
    expect(added?.nextCycleReferenceMonth).toBe("2026-09");

    await generateBillingPeriod(organizationId, groupId, "2026-08");
    expect(await db.select().from(charges)).toHaveLength(0);

    await generateBillingPeriod(organizationId, groupId, "2026-09");
    expect(await db.select().from(charges)).toHaveLength(1);
  });

  it("ao mover o responsavel para outro telefone promove o dependente restante", async () => {
    const responsible = await findOrCreateParticipantByPhone(organizationId, "(11) 98888-0004", "Responsável");
    const dependent = await findOrCreateParticipantByPhone(organizationId, "(11) 98888-0004", "Dependente");

    await updateParticipant(organizationId, responsible.id, {
      name: "Responsável",
      phone: "(11) 98888-0005",
    });

    const [promoted] = await db
      .select()
      .from(participantRows)
      .where(eq(participantRows.id, dependent.id));
    expect(promoted.financialRole).toBe("responsible");
  });

  it("rejeita telefone inválido sem DDD ou código do país", async () => {
    await expect(
      addParticipantToGroup(organizationId, groupId, { name: "Inválido", phone: "11 1234-5678" }),
    ).rejects.toThrow();
  });

  it("grava a tag no vinculo e registra a ordem de cadastro em group_tags", async () => {
    const added = await addParticipantToGroup(
      organizationId,
      groupId,
      { name: "Ana", phone: "(11) 98888-0010", tag: "Sub-15" },
      new Date("2026-08-01T12:00:00Z"),
    );

    const result = await listGroupParticipants(organizationId, groupId);
    const row = result!.participants.find((p) => p.participantId === added!.participant.id);
    expect(row?.tag).toBe("Sub-15");
    expect(result!.tagOrder).toEqual(["Sub-15"]);
  });

  it("updateGroupParticipantTag altera a tag e preserva a ordem de cadastro ja existente", async () => {
    const first = await addParticipantToGroup(
      organizationId,
      groupId,
      { name: "Beto", phone: "(11) 98888-0011", tag: "Sub-15" },
      new Date("2026-08-01T12:00:00Z"),
    );
    const second = await addParticipantToGroup(
      organizationId,
      groupId,
      { name: "Carla", phone: "(11) 98888-0012" },
      new Date("2026-08-01T12:00:00Z"),
    );

    const updated = await updateGroupParticipantTag(organizationId, groupId, second!.participant.id, { tag: "Veterano" });
    expect(updated?.tag).toBe("Veterano");

    // "Sub-15" ja existia antes de "Veterano" — a ordem reflete quem foi cadastrado primeiro.
    const result = await listGroupParticipants(organizationId, groupId);
    expect(result!.tagOrder).toEqual(["Sub-15", "Veterano"]);

    // Reaproveitar "Sub-15" de novo nao deve duplicar nem reordenar o catalogo.
    await updateGroupParticipantTag(organizationId, groupId, first!.participant.id, { tag: "Sub-15" });
    const afterReuse = await listGroupParticipants(organizationId, groupId);
    expect(afterReuse!.tagOrder).toEqual(["Sub-15", "Veterano"]);
  });

  it("updateGroupParticipantTag retorna null para vinculo de outra organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98888-0013");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));

    const result = await updateGroupParticipantTag(otherOrg.id, groupId, participant.id, { tag: "Sub-15" });
    expect(result).toBeNull();
  });
});
