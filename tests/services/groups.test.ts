import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, charges } from "@/db/schema";
import { createGroup, listGroups, getGroupPublicSummary, updateGroup, archiveGroup } from "@/services/groups";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { registerManualSettlement } from "@/services/manual-settlement";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

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

    expect(group.publicSlug).toMatch(/^volei-de-quarta-[A-Za-z0-9_-]{16}$/);
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

  it("retorna nome e status de um grupo existente pelo slug publico", async () => {
    const group = await createGroup(organizationId, {
      name: "Futevôlei de sábado",
      sport: "Futevôlei",
      billingDay: 15,
      defaultAmount: 5000,
    });

    const summary = await getGroupPublicSummary(group.publicSlug);
    expect(summary).toEqual({ name: "Futevôlei de sábado", status: "active" });
  });

  it("retorna null quando o slug publico nao existe", async () => {
    const summary = await getGroupPublicSummary("slug-que-nao-existe");
    expect(summary).toBeNull();
  });

  it("atualiza o nome de um grupo da propria organizacao", async () => {
    const group = await createGroup(organizationId, { name: "Nome antigo", billingDay: 5, defaultAmount: 8000 });

    const updated = await updateGroup(organizationId, group.id, { name: "Nome novo" });

    expect(updated?.name).toBe("Nome novo");
  });

  it("cria um grupo sem billingDay (renovacao manual)", async () => {
    const group = await createGroup(organizationId, { name: "Grupo manual", defaultAmount: 8000 });

    expect(group.billingDay).toBeNull();
  });

  it("limpa o billingDay explicitamente (volta para renovacao manual)", async () => {
    const group = await createGroup(organizationId, { name: "Grupo com ciclo", billingDay: 10, defaultAmount: 8000 });

    const updated = await updateGroup(organizationId, group.id, { billingDay: null });

    expect(updated?.billingDay).toBeNull();
  });

  it("atualiza a mensagem de cobranca do grupo", async () => {
    const group = await createGroup(organizationId, { name: "Grupo com mensagem", billingDay: 5, defaultAmount: 8000 });

    const updated = await updateGroup(organizationId, group.id, {
      messageIntro: "Oi, {grupo}!",
      messageOutro: "Valeu!",
      messageParticipantFilter: "pending",
    });

    expect(updated?.messageIntro).toBe("Oi, {grupo}!");
    expect(updated?.messageOutro).toBe("Valeu!");
    expect(updated?.messageParticipantFilter).toBe("pending");
  });

  it("nao atualiza grupo de outra organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();
    const group = await createGroup(otherOrg.id, { name: "Grupo de outra org", billingDay: 5, defaultAmount: 8000 });

    const result = await updateGroup(organizationId, group.id, { name: "Tentativa" });

    expect(result).toBeNull();
  });

  it("arquiva um grupo sem cobrancas em aberto", async () => {
    const group = await createGroup(organizationId, { name: "Grupo tranquilo", billingDay: 5, defaultAmount: 8000 });

    const archived = await archiveGroup(organizationId, group.id);

    expect(archived?.status).toBe("archived");
  });

  it("nao arquiva grupo de outra organizacao", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Outra Org" }).returning();
    const group = await createGroup(otherOrg.id, { name: "Grupo de outra org", billingDay: 5, defaultAmount: 8000 });

    const result = await archiveGroup(organizationId, group.id);

    expect(result).toBeNull();
  });

  it("bloqueia arquivamento de grupo com cobranca em aberto", async () => {
    const group = await createGroup(organizationId, { name: "Grupo com pendencia", billingDay: 5, defaultAmount: 8000 });
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, group.id, participant.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, group.id, "2026-08");

    await expect(archiveGroup(organizationId, group.id)).rejects.toThrow("cobranças em aberto");

    const [unchanged] = await db.select().from(groups).where(eq(groups.id, group.id));
    expect(unchanged.status).toBe("active");
  });

  it("permite arquivar grupo cujas cobrancas ja foram todas pagas", async () => {
    const group = await createGroup(organizationId, { name: "Grupo quitado", billingDay: 5, defaultAmount: 8000 });
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410");
    await linkParticipantToGroup(organizationId, group.id, participant.id, new Date("2026-08-01T12:00:00Z"));
    const period = await generateBillingPeriod(organizationId, group.id, "2026-08");
    const userId = "11111111-1111-1111-1111-111111111111";

    const [pendingCharge] = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    await registerManualSettlement(organizationId, userId, pendingCharge.id, { paymentMethod: "dinheiro" });

    const archived = await archiveGroup(organizationId, group.id);
    expect(archived?.status).toBe("archived");
  });
});
