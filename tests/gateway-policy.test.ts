import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { isXGateEnabledForOrganization, getOrganizationCheckoutProvider } from "@/payments/gateway-policy";
import { truncateAll } from "./helpers/db";

const originalEnabled = process.env.XGATE_ENABLED;
const originalAllowlist = process.env.XGATE_ORGANIZATION_IDS;

describe("gateway-policy", () => {
  let freeOrgId: string;
  let premiumOrgId: string;

  beforeEach(async () => {
    await truncateAll();
    const [free] = await db.insert(organizations).values({ name: "Org Grátis" }).returning();
    freeOrgId = free.id;
    const [premium] = await db.insert(organizations).values({ name: "Org Premium", billingModule: "cobradora", organizerPhoneNormalized: "+5511900000000", organizerPhoneDisplay: "(11) 90000-0000" }).returning();
    premiumOrgId = premium.id;
    process.env.XGATE_ENABLED = "true";
    delete process.env.XGATE_ORGANIZATION_IDS;
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.XGATE_ENABLED; else process.env.XGATE_ENABLED = originalEnabled;
    if (originalAllowlist === undefined) delete process.env.XGATE_ORGANIZATION_IDS; else process.env.XGATE_ORGANIZATION_IDS = originalAllowlist;
  });

  it("organização grátis nunca é elegível, mesmo com XGATE_ENABLED=true", async () => {
    expect(await isXGateEnabledForOrganization(freeOrgId)).toBe(false);
  });

  it("plano premium habilita XGate mesmo com flag global legada false", async () => {
    process.env.XGATE_ENABLED = "false";
    expect(await isXGateEnabledForOrganization(premiumOrgId)).toBe(true);
  });

  it("organização premium é elegível sem flag global", async () => {
    delete process.env.XGATE_ENABLED;
    expect(await isXGateEnabledForOrganization(premiumOrgId)).toBe(true);
  });

  it("allowlist legada não impede a habilitação pelo plano premium", async () => {
    process.env.XGATE_ORGANIZATION_IDS = crypto.randomUUID();
    expect(await isXGateEnabledForOrganization(premiumOrgId)).toBe(true);

    process.env.XGATE_ORGANIZATION_IDS = `${crypto.randomUUID()},${premiumOrgId}`;
    expect(await isXGateEnabledForOrganization(premiumOrgId)).toBe(true);
  });

  it("getOrganizationCheckoutProvider reflete a elegibilidade", async () => {
    expect(await getOrganizationCheckoutProvider(freeOrgId)).toBe("infinitepay");
    expect(await getOrganizationCheckoutProvider(premiumOrgId)).toBe("xgate");
  });
});
