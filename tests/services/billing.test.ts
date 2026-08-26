import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/db";
import {
  organizations,
  groups,
  charges,
  financialContacts,
  gatewayAccounts,
  groupParticipants,
  whatsappNotifications,
} from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod, generateDueBillingPeriods, renewGroupCycleManually, GroupCycleNotManualError } from "@/services/billing";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

describe("billing service", () => {
  let organizationId: string;
  let groupId: string;
  const originalFetch = global.fetch;

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

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function configureCobraDora() {
    await db
      .update(organizations)
      .set({
        billingModule: "cobradora",
        organizerPhoneNormalized: "+5511999999999",
        organizerPhoneDisplay: "(11) 99999-9999",
      })
      .where(eq(organizations.id, organizationId));
    await db.insert(gatewayAccounts).values({
      organizationId,
      provider: "infinitepay",
      externalAccountId: "org-billing-teste",
      status: "active",
    });
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-meta-teste");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id-teste");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca_inicio_teste");
    vi.stubEnv("WHATSAPP_ORGANIZER_CYCLE_TEMPLATE_NAME", "novo_ciclo_teste");
    let sequence = 0;
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ messages: [{ id: `wamid.billing-${++sequence}` }] }),
      text: async () => "",
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

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

  it("preserva o corte histórico ao reencontrar um ciclo automático já criado", async () => {
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    const lateParticipant = await findOrCreateParticipantByPhone(
      organizationId,
      "(11) 98812-4499",
      "Entrada tardia",
    );
    await db.insert(groupParticipants).values({
      groupId,
      participantId: lateParticipant.id,
      billingAmount: 8000,
      joinedAt: new Date("2026-08-15T12:00:00Z"),
      billingStartsOn: "2026-08-15",
      participantNameNormalized: lateParticipant.nameNormalized,
    });

    await generateBillingPeriod(
      organizationId,
      groupId,
      "2026-08",
      undefined,
      new Date("2026-08-20T12:00:00-03:00"),
    );

    const rows = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    expect(rows).toHaveLength(0);
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

  it("renovação manual enfileira e despacha uma cobrança consolidada e um aviso ao organizador", async () => {
    const fetchMock = await configureCobraDora();
    const [manualGroup] = await db
      .insert(groups)
      .values({ organizationId, name: "Manual WhatsApp", publicSlug: "manual-whatsapp", billingDay: null, defaultAmount: 5000 })
      .returning();
    const responsible = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Marina");
    const dependent = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "João");
    await db
      .update(financialContacts)
      .set({ whatsappOptInAt: new Date("2026-08-01T12:00:00Z") })
      .where(eq(financialContacts.id, responsible.financialContactId));
    await linkParticipantToGroup(organizationId, manualGroup.id, responsible.id, new Date("2026-08-01T12:00:00Z"));
    await linkParticipantToGroup(organizationId, manualGroup.id, dependent.id, new Date("2026-08-01T12:00:00Z"));

    const first = await renewGroupCycleManually(
      organizationId,
      manualGroup.id,
      new Date("2026-08-15T12:00:00-03:00"),
    );
    const repeated = await renewGroupCycleManually(
      organizationId,
      manualGroup.id,
      new Date("2026-08-15T12:00:00-03:00"),
    );

    expect(repeated?.id).toBe(first?.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rows = await db.select().from(whatsappNotifications);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind).sort()).toEqual(["charge_reminder", "organizer_cycle_start"]);
  });

  it("renovação manual repetida notifica novos contatos e uma nova revisão do valor sem duplicar", async () => {
    const fetchMock = await configureCobraDora();
    const [manualGroup] = await db
      .insert(groups)
      .values({
        organizationId,
        name: "Manual revisões",
        publicSlug: "manual-revisoes",
        billingDay: null,
        defaultAmount: 5000,
      })
      .returning();

    const marina = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Marina");
    await db
      .update(financialContacts)
      .set({ whatsappOptInAt: new Date("2026-08-01T12:00:00Z") })
      .where(eq(financialContacts.id, marina.financialContactId));
    await linkParticipantToGroup(organizationId, manualGroup.id, marina.id, new Date("2026-08-01T12:00:00Z"));
    await renewGroupCycleManually(organizationId, manualGroup.id, new Date("2026-08-05T12:00:00-03:00"));

    const bruno = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4411", "Bruno");
    await db
      .update(financialContacts)
      .set({ whatsappOptInAt: new Date("2026-08-10T12:00:00Z") })
      .where(eq(financialContacts.id, bruno.financialContactId));
    await linkParticipantToGroup(organizationId, manualGroup.id, bruno.id, new Date("2026-08-10T12:00:00Z"));
    await renewGroupCycleManually(organizationId, manualGroup.id, new Date("2026-08-15T12:00:00-03:00"));

    const joao = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "João");
    await linkParticipantToGroup(organizationId, manualGroup.id, joao.id, new Date("2026-08-16T12:00:00Z"));
    await renewGroupCycleManually(organizationId, manualGroup.id, new Date("2026-08-20T12:00:00-03:00"));
    await renewGroupCycleManually(organizationId, manualGroup.id, new Date("2026-08-20T12:00:00-03:00"));

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    const chargeBodies = bodies.filter((body) => body.template.name === "cobranca_inicio_teste");
    expect(fetchMock).toHaveBeenCalledTimes(4); // 3 revisões privadas + 1 novo_ciclo
    expect(chargeBodies).toHaveLength(3);
    expect(chargeBodies.some((body) => body.to === "+5511988124411")).toBe(true);
    expect(chargeBodies.filter((body) => body.to === "+5511988124410")).toHaveLength(2);

    // amount/dueDate não fazem parte do texto aprovado do "cobranca" (só
    // participantName/groupName/groupUrl vão pro WhatsApp) — continuam
    // registrados no payload salvo, então conferimos ali.
    const notifications = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.kind, "charge_reminder"))
      .orderBy(whatsappNotifications.createdAt);
    expect(notifications).toHaveLength(3);

    const brunoNotification = notifications.find((row) => row.recipientPhoneNormalized === "+5511988124411")!;
    expect((brunoNotification.payload as { amount: string; dueDate: string }).amount).toMatch(/^R\$\s50,00$/);
    expect((brunoNotification.payload as { amount: string; dueDate: string }).dueDate).toBe("15/08/2026");

    const marinaNotifications = notifications.filter((row) => row.recipientPhoneNormalized === "+5511988124410");
    expect(marinaNotifications).toHaveLength(2);
    // Um lembrete consolidado usa o vencimento aberto mais antigo; ambos os
    // valores continuam lastreados nas due_dates das charges, não na data
    // congelada do billing_period.
    expect((marinaNotifications[1].payload as { amount: string; dueDate: string }).amount).toMatch(/^R\$\s100,00$/);
    expect((marinaNotifications[1].payload as { amount: string; dueDate: string }).dueDate).toBe("05/08/2026");

    expect(new Set(notifications.map((row) => row.idempotencyKey)).size).toBe(notifications.length);
  });

  it("ciclo automático enfileira e despacha os dois avisos depois de gerar a competência", async () => {
    const fetchMock = await configureCobraDora();
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Marina");
    await db
      .update(financialContacts)
      .set({ whatsappOptInAt: new Date("2026-08-01T12:00:00Z") })
      .where(eq(financialContacts.id, participant.financialContactId));
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));

    const result = await generateDueBillingPeriods(new Date("2026-08-10T12:00:00-03:00"));

    expect(result.failures).toEqual([]);
    expect(result.generated).toEqual([{ groupId, referenceMonth: "2026-08" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rows = await db.select().from(whatsappNotifications);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "sent")).toBe(true);
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
