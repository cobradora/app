import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/db";
import {
  charges,
  financialContacts,
  gatewayAccounts,
  groups,
  organizations,
  whatsappNotifications,
} from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { registerManualSettlement } from "@/services/manual-settlement";
import { sendDailyPaymentReminders } from "@/services/whatsapp-reminders";
import {
  dispatchWhatsappNotifications,
  enqueueCycleStartNotifications,
  enqueueOrganizerListUpdates,
  processWhatsappDeliveryStatuses,
} from "@/services/whatsapp-notifications";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

describe("whatsapp-reminders service", () => {
  let organizationId: string;
  let groupId: string;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-meta-teste");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id-teste");
    vi.stubEnv("WHATSAPP_CHARGE_TEMPLATE_NAME", "cobranca_pendente_teste");
    vi.stubEnv("WHATSAPP_ORGANIZER_CYCLE_TEMPLATE_NAME", "novo_ciclo_teste");

    const [org] = await db
      .insert(organizations)
      .values({
        name: "Org Teste",
        billingModule: "cobradora",
        organizerPhoneNormalized: "+5511999999999",
        organizerPhoneDisplay: "(11) 99999-9999",
      })
      .returning();
    organizationId = org.id;
    const [group] = await db
      .insert(groups)
      .values({ organizationId, name: "Vôlei", publicSlug: "volei-abcd", billingDay: 5, defaultAmount: 8000 })
      .returning();
    groupId = group.id;
    await db.insert(gatewayAccounts).values({
      organizationId,
      provider: "infinitepay",
      externalAccountId: "org-teste",
      status: "active",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function addParticipant(phone: string, name: string, optIn = true) {
    const participant = await findOrCreateParticipantByPhone(organizationId, phone, name);
    if (optIn) {
      await db
        .update(financialContacts)
        .set({ whatsappOptInAt: new Date("2026-08-01T12:00:00Z"), whatsappOptOutAt: null })
        .where(eq(financialContacts.id, participant.financialContactId));
    }
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    return participant;
  }

  function mockMetaSuccess() {
    let sequence = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      sequence += 1;
      return {
        ok: true,
        json: async () => ({
          messages: [{ id: sequence === 1 ? "wamid.lembrete-teste" : `wamid.lembrete-teste-${sequence}` }],
        }),
        text: async () => "",
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("envia uma cobrança aberta no privado somente com CobraDora, InfinitePay ativa e opt-in explícito", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const fetchMock = mockMetaSuccess();

    const result = await sendDailyPaymentReminders();

    expect(result).toEqual({ queued: 2, sent: 2, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toBe("+5511988124410");
    expect(body.template.name).toBe("cobranca_pendente_teste");
    // Cabeçalho do "cobranca" é texto estático; amount/dueDate não fazem
    // parte do corpo aprovado, só participantName/groupName/groupUrl.
    expect(body.template.components).toHaveLength(1);
    expect(body.template.components[0].parameters.map((item: { text: string }) => item.text)).toEqual([
      "Marina Costa",
      "Vôlei",
      expect.stringContaining("/g/volei-abcd"),
    ]);
  });

  it("não envia no módulo Dora mesmo com conta InfinitePay e consentimento", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    await db.update(organizations).set({ billingModule: "dora" }).where(eq(organizations.id, organizationId));
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendDailyPaymentReminders();

    expect(result).toEqual({ queued: 0, sent: 0, skipped: 0, failures: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(whatsappNotifications)).toHaveLength(0);
  });

  it("sem opt-in não envia ao contato, mas reconcilia o aviso de ciclo do organizador", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa", false);
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const fetchMock = mockMetaSuccess();

    const result = await sendDailyPaymentReminders();

    expect(result).toEqual({ queued: 1, sent: 1, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [notification] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.metaMessageId, "wamid.lembrete-teste"));
    expect(notification.kind).toBe("organizer_cycle_start");
  });

  it("não envia cobrança já paga, preservando somente o aviso de início do ciclo", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    const [charge] = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    await registerManualSettlement(organizationId, "11111111-1111-1111-1111-111111111111", charge.id, {
      paymentMethod: "pix",
    });
    const fetchMock = mockMetaSuccess();

    const result = await sendDailyPaymentReminders();

    expect(result).toEqual({ queued: 1, sent: 1, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [notification] = await db.select().from(whatsappNotifications);
    expect(notification.kind).toBe("organizer_cycle_start");
  });

  it("agrega dependentes do mesmo contato e não duplica no cron seguinte", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    await addParticipant("(11) 98812-4410", "João Costa");
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const fetchMock = mockMetaSuccess();

    const first = await sendDailyPaymentReminders();
    const second = await sendDailyPaymentReminders();

    expect(first).toEqual({ queued: 2, sent: 2, skipped: 0, failures: [] });
    expect(second).toEqual({ queued: 0, sent: 0, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // O valor agregado não faz parte do texto aprovado do "cobranca" (só
    // participantName/groupName/groupUrl vão pro WhatsApp), mas continua
    // registrado no payload salvo para histórico/auditoria.
    const [notification] = await db.select().from(whatsappNotifications).where(eq(whatsappNotifications.kind, "charge_reminder"));
    expect((notification.payload as { amount: string }).amount).toMatch(/^R\$\s160,00$/);
    expect(await db.select().from(whatsappNotifications)).toHaveLength(2);
  });

  it("reconcilia somente a competência mais recente e não dispara catch-up histórico", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    const historicalPeriod = await generateBillingPeriod(organizationId, groupId, "2026-08");
    const latestPeriod = await generateBillingPeriod(organizationId, groupId, "2026-09");
    const fetchMock = mockMetaSuccess();

    const result = await sendDailyPaymentReminders();

    expect(result).toEqual({ queued: 2, sent: 2, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const notifications = await db.select().from(whatsappNotifications);
    expect(notifications).toHaveLength(2);
    expect(notifications.every((row) => row.billingPeriodId === latestPeriod.id)).toBe(true);
    expect(notifications.some((row) => row.billingPeriodId === historicalPeriod.id)).toBe(false);
  });

  it("no início do ciclo consolida o contato, avisa o organizador uma vez e compartilha a dedupe com o cron", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    await addParticipant("(11) 98812-4410", "João Costa");
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    let messageSequence = 0;
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ messages: [{ id: `wamid.inicio-${++messageSequence}` }] }),
      text: async () => "",
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const notificationIds = await enqueueCycleStartNotifications([period.id]);
    const repeatedIds = await enqueueCycleStartNotifications([period.id]);
    const dispatch = await dispatchWhatsappNotifications(notificationIds);
    const daily = await sendDailyPaymentReminders();

    expect(notificationIds).toHaveLength(2);
    expect(repeatedIds).toEqual([]);
    expect(dispatch).toEqual({ sent: 2, skipped: 0, failures: [] });
    expect(daily).toEqual({ queued: 0, sent: 0, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const rows = await db.select().from(whatsappNotifications);
    expect(rows.map((row) => row.kind).sort()).toEqual(["charge_reminder", "organizer_cycle_start"]);
    const chargeReminder = rows.find((row) => row.kind === "charge_reminder");
    const organizerCycle = rows.find((row) => row.kind === "organizer_cycle_start");
    expect(chargeReminder?.payload).toEqual(expect.objectContaining({ amount: expect.stringMatching(/^R\$\s160,00$/) }));
    expect(organizerCycle?.payload).toEqual(
      expect.objectContaining({ participantCount: "2", totalAmount: expect.stringMatching(/^R\$\s160,00$/) }),
    );

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies.map((body) => body.template.name).sort()).toEqual([
      "cobranca_pendente_teste",
      "novo_ciclo_teste",
    ]);
    expect(bodies.map((body) => body.to).sort()).toEqual(["+5511988124410", "+5511999999999"]);
  });

  it("registra graph_api_400 sem derrubar o lote inteiro", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "template inválido" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendDailyPaymentReminders();

    expect(result.queued).toBe(2);
    expect(result.sent).toBe(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].code).toBe("graph_api_400");
    const notifications = await db.select().from(whatsappNotifications);
    expect(notifications.every((notification) => notification.status === "failed")).toBe(true);
    expect(notifications.every((notification) => notification.errorCode === "graph_api_400")).toBe(true);
    expect(notifications.every((notification) => notification.nextAttemptAt.getUTCFullYear() === 9999)).toBe(true);

    const repeated = await dispatchWhatsappNotifications(notifications.map((notification) => notification.id));
    expect(repeated).toEqual({ sent: 0, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respeita Retry-After, tenta novamente 429/5xx e encerra no teto de cinco tentativas", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    const notificationIds = await enqueueCycleStartNotifications([period.id]);
    const notifications = await db.select().from(whatsappNotifications);
    const chargeReminder = notifications.find((row) => row.kind === "charge_reminder")!;
    const organizerCycle = notifications.find((row) => row.kind === "organizer_cycle_start")!;

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name: string) => name.toLowerCase() === "retry-after" ? "3600" : null },
        text: async () => "rate limit",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => null },
        text: async () => "indisponível",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => null },
        text: async () => "indisponível",
      }) as unknown as typeof fetch;

    const rateLimited = await dispatchWhatsappNotifications([chargeReminder.id]);
    const unavailable = await dispatchWhatsappNotifications([organizerCycle.id]);
    expect(rateLimited.failures[0].code).toBe("graph_api_429");
    expect(unavailable.failures[0].code).toBe("graph_api_503");

    const [afterRateLimit] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.id, chargeReminder.id));
    expect(afterRateLimit.nextAttemptAt.getTime() - afterRateLimit.failedAt!.getTime()).toBeGreaterThanOrEqual(3_600_000);
    expect(afterRateLimit.nextAttemptAt.getUTCFullYear()).not.toBe(9999);

    await db
      .update(whatsappNotifications)
      .set({ attemptCount: 4, nextAttemptAt: new Date("2026-08-01T00:00:00Z") })
      .where(eq(whatsappNotifications.id, chargeReminder.id));
    const exhausted = await dispatchWhatsappNotifications([chargeReminder.id]);
    expect(exhausted.failures[0].code).toBe("graph_api_503_retry_exhausted");
    const [deadLetter] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.id, chargeReminder.id));
    expect(deadLetter.attemptCount).toBe(5);
    expect(deadLetter.nextAttemptAt.getUTCFullYear()).toBe(9999);
    expect(notificationIds).toHaveLength(2);
  });

  it("adia checkout_pending e retoma a mesma notificação quando a charge volta a open", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    await enqueueCycleStartNotifications([period.id]);
    const [charge] = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    const [notification] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.kind, "charge_reminder"));
    await db.update(charges).set({ status: "checkout_pending" }).where(eq(charges.id, charge.id));
    const fetchMock = mockMetaSuccess();

    const deferred = await dispatchWhatsappNotifications([notification.id]);
    expect(deferred).toEqual({
      sent: 0,
      skipped: 0,
      failures: [{ notificationId: notification.id, code: "checkout_pending" }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const [waiting] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.id, notification.id));
    expect(waiting.attemptCount).toBe(0);
    expect(waiting.nextAttemptAt.getUTCFullYear()).not.toBe(9999);

    await db.update(charges).set({ status: "open" }).where(eq(charges.id, charge.id));
    await db
      .update(whatsappNotifications)
      .set({ nextAttemptAt: new Date("2026-08-01T00:00:00Z") })
      .where(eq(whatsappNotifications.id, notification.id));
    const resumed = await dispatchWhatsappNotifications([notification.id]);
    expect(resumed).toEqual({ sent: 1, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // "adia configuração de gateway temporária" removida: CobraDora agora usa XGate com
  // credenciais globais de servidor, sem conta InfinitePay conectável por organização
  // para desativar/reativar — o cenário que este teste cobria não existe mais.

  it("não reativa lembrete histórico depois de meses no modo Dora", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    const historicalPeriod = await generateBillingPeriod(organizationId, groupId, "2026-08");
    await enqueueCycleStartNotifications([historicalPeriod.id]);
    const [historicalReminder] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.kind, "charge_reminder"));
    await db.update(organizations).set({ billingModule: "dora" }).where(eq(organizations.id, organizationId));

    const whileDora = await dispatchWhatsappNotifications([historicalReminder.id]);
    expect(whileDora.failures[0].code).toBe("organization_temporarily_ineligible");
    expect((await db.select().from(whatsappNotifications).where(eq(whatsappNotifications.id, historicalReminder.id)))[0].attemptCount).toBe(0);

    const latestPeriod = await generateBillingPeriod(organizationId, groupId, "2026-09");
    await db.update(organizations).set({ billingModule: "cobradora" }).where(eq(organizations.id, organizationId));
    await db
      .update(whatsappNotifications)
      .set({ nextAttemptAt: new Date("2026-08-01T00:00:00Z") })
      .where(eq(whatsappNotifications.id, historicalReminder.id));
    const fetchMock = mockMetaSuccess();

    expect(await dispatchWhatsappNotifications([historicalReminder.id])).toEqual({ sent: 0, skipped: 1, failures: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    const [superseded] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.id, historicalReminder.id));
    expect(superseded.errorCode).toBe("superseded");
    expect(superseded.nextAttemptAt.getUTCFullYear()).toBe(9999);
    expect(latestPeriod.referenceMonth).toBe("2026-09");
  });

  it("usa fencing do claim: o worker que perdeu o lease não sobrescreve nem conta o envio", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    await enqueueCycleStartNotifications([period.id]);
    const [notification] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.kind, "charge_reminder"));

    let releaseFirst!: (response: unknown) => void;
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        signalFirstStarted();
        return firstResponse;
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: "wamid.claim-vencedor" }] }),
        text: async () => "",
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const firstWorker = dispatchWhatsappNotifications([notification.id]);
    await firstStarted;
    await db
      .update(whatsappNotifications)
      .set({ lastAttemptAt: new Date("2000-01-01T00:00:00Z") })
      .where(eq(whatsappNotifications.id, notification.id));
    const secondWorker = await dispatchWhatsappNotifications([notification.id]);
    releaseFirst({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.claim-perdido" }] }),
      text: async () => "",
    });
    const firstResult = await firstWorker;

    expect(secondWorker).toEqual({ sent: 1, skipped: 0, failures: [] });
    expect(firstResult).toEqual({ sent: 0, skipped: 0, failures: [] });
    const [stored] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.id, notification.id));
    expect(stored.attemptCount).toBe(2);
    expect(stored.metaMessageId).toBe("wamid.claim-vencedor");
  });

  it("valida APP_BASE_URL e falha fechado em produção", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    vi.stubEnv("NODE_ENV", "production");

    vi.stubEnv("APP_BASE_URL", "");
    await expect(enqueueCycleStartNotifications([period.id])).rejects.toThrow(/APP_BASE_URL ausente/);
    vi.stubEnv("APP_BASE_URL", "http://cobradora.example");
    await expect(enqueueCycleStartNotifications([period.id])).rejects.toThrow(/HTTPS/);
    vi.stubEnv("APP_BASE_URL", "ftp://cobradora.example");
    await expect(enqueueCycleStartNotifications([period.id])).rejects.toThrow(/HTTP ou HTTPS/);
    expect(await db.select().from(whatsappNotifications)).toHaveLength(0);
  });

  it("não regride o recibo da Meta de read para delivered", async () => {
    await addParticipant("(11) 98812-4410", "Marina Costa");
    await generateBillingPeriod(organizationId, groupId, "2026-08");
    mockMetaSuccess();
    await sendDailyPaymentReminders();

    const metaPayload = (status: "read" | "delivered", timestamp: string) => ({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.lembrete-teste", status, timestamp }] } }] }],
    });
    expect(await processWhatsappDeliveryStatuses(metaPayload("read", "1788134400"))).toEqual({ updated: 1 });
    expect(await processWhatsappDeliveryStatuses(metaPayload("delivered", "1788134460"))).toEqual({ updated: 0 });

    const [notification] = await db
      .select()
      .from(whatsappNotifications)
      .where(eq(whatsappNotifications.metaMessageId, "wamid.lembrete-teste"));
    expect(notification.status).toBe("read");
    expect(notification.readAt).not.toBeNull();
  });

  it("recalcula a lista atual do organizador antes do retry", async () => {
    const marina = await addParticipant("(11) 98812-4410", "Marina Costa", false);
    await addParticipant("(11) 90000-0002", "Bruno Alves", false);
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    vi.stubEnv("WHATSAPP_ORGANIZER_UPDATE_TEMPLATE_NAME", "lista_atualizada_teste");

    const notificationIds = await enqueueOrganizerListUpdates(db, {
      organizationId,
      paymentId: "22222222-2222-2222-2222-222222222222",
      billingPeriodIds: [period.id],
    });
    expect(notificationIds).toHaveLength(1);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: { get: () => null }, text: async () => "falha temporária" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: "wamid.organizador-retry" }] }),
        text: async () => "",
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const firstDispatch = await dispatchWhatsappNotifications(notificationIds);
    expect(firstDispatch.failures[0].code).toBe("graph_api_503");

    const [marinaCharge] = await db.select().from(charges).where(eq(charges.participantId, marina.id));
    await registerManualSettlement(
      organizationId,
      "11111111-1111-1111-1111-111111111111",
      marinaCharge.id,
      { paymentMethod: "pix" },
    );
    await db
      .update(whatsappNotifications)
      .set({ nextAttemptAt: new Date("2026-08-01T00:00:00Z") })
      .where(eq(whatsappNotifications.id, notificationIds[0]));

    const retry = await dispatchWhatsappNotifications(notificationIds);

    expect(retry).toEqual({ sent: 1, skipped: 0, failures: [] });
    const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    // Cabeçalho (nome do grupo) e corpo (mês, pagos, pendentes) são
    // componentes separados, cada um com sua própria numeração de {{n}}.
    expect(retryBody.template.components[1].parameters[1].text).toContain("Marina Costa");
    expect(retryBody.template.components[1].parameters[2].text).toContain("Bruno Alves");
    const [notification] = await db.select().from(whatsappNotifications);
    expect(notification.status).toBe("sent");
    expect(notification.payload).toEqual(
      expect.objectContaining({ paidList: expect.stringContaining("Marina Costa"), pendingList: expect.stringContaining("Bruno Alves") }),
    );
  });
});
