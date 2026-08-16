import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/db";
import { organizations, groups, charges } from "@/db/schema";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { generateBillingPeriod } from "@/services/billing";
import { registerManualSettlement } from "@/services/manual-settlement";
import { sendDailyPaymentReminders } from "@/services/whatsapp-reminders";
import { truncateAll } from "../helpers/db";
import { eq } from "drizzle-orm";

describe("whatsapp-reminders service", () => {
  let organizationId: string;
  let groupId: string;
  const originalFetch = global.fetch;

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

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("manda lembrete só para cobranças em aberto, para o telefone do responsável", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Marina Costa");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, groupId, "2026-08");

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendDailyPaymentReminders();

    expect(result.sent).toBe(1);
    expect(result.failures).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toBe("+5511988124410");
    expect(body.template.components[0].parameters[0].text).toBe("Marina Costa");
    expect(body.template.components[0].parameters[1].text).toBe("Vôlei");
  });

  it("não manda lembrete para cobrança já paga", async () => {
    const participant = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Marina Costa");
    await linkParticipantToGroup(organizationId, groupId, participant.id, new Date("2026-08-01T12:00:00Z"));
    const period = await generateBillingPeriod(organizationId, groupId, "2026-08");
    const [charge] = await db.select().from(charges).where(eq(charges.billingPeriodId, period.id));
    await registerManualSettlement(organizationId, "11111111-1111-1111-1111-111111111111", charge.id, { paymentMethod: "pix" });

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendDailyPaymentReminders();

    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registra falha por cobrança sem derrubar o lote inteiro", async () => {
    const first = await findOrCreateParticipantByPhone(organizationId, "(11) 98812-4410", "Marina Costa");
    await linkParticipantToGroup(organizationId, groupId, first.id, new Date("2026-08-01T12:00:00Z"));
    const second = await findOrCreateParticipantByPhone(organizationId, "(11) 90000-0002", "Bruno Alves");
    await linkParticipantToGroup(organizationId, groupId, second.id, new Date("2026-08-01T12:00:00Z"));
    await generateBillingPeriod(organizationId, groupId, "2026-08");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "erro" })
      .mockResolvedValueOnce({ ok: true, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendDailyPaymentReminders();

    expect(result.sent).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].code).toBe("send_failed");
  });
});
