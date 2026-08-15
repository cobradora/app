import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from "@/services/organization-settings";
import { MESSAGE_PART_MAX_LENGTH } from "@/lib/normalization";
import { truncateAll } from "../helpers/db";

describe("organization-settings service", () => {
  let organizationId: string;

  beforeEach(async () => {
    await truncateAll();
    const [organization] = await db
      .insert(organizations)
      .values({ name: "Org Teste" })
      .returning();
    organizationId = organization.id;
  });

  it("cria configurações vazias na primeira leitura", async () => {
    const settings = await getOrganizationSettings(organizationId);

    expect(settings.organizationId).toBe(organizationId);
    expect(settings.messageIntro).toBe("");
    expect(settings.messageOutro).toBe("");
    expect(settings.messageParticipantFilter).toBe("all");
  });

  it("atualiza o filtro de participantes da mensagem isoladamente", async () => {
    const settings = await updateOrganizationSettings(organizationId, {
      messageParticipantFilter: "pending",
    });

    expect(settings.messageParticipantFilter).toBe("pending");
    expect(settings.messageIntro).toBe("");
  });

  it("atualiza somente os campos enviados", async () => {
    await updateOrganizationSettings(organizationId, {
      messageIntro: "  Olá, tudo bem?  ",
      messageOutro: "Até logo",
    });

    const settings = await updateOrganizationSettings(organizationId, {
      messageOutro: "  Obrigada!  ",
    });

    expect(settings.messageIntro).toBe("Olá, tudo bem?");
    expect(settings.messageOutro).toBe("Obrigada!");
  });

  it("aplica limite de caracteres às partes personalizáveis", async () => {
    await expect(
      updateOrganizationSettings(organizationId, {
        messageIntro: "a".repeat(MESSAGE_PART_MAX_LENGTH + 1),
      }),
    ).rejects.toThrow();
  });
});
