import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";

/** Availability belongs to the organization, not the server environment.
 * Saving Premium (CobraDora) enables XGate; free (Dora) uses InfinitePay.
 * Credentials remain server-only and are checked by the XGate client. */
export async function getXGateOrganizationAvailability(organizationId: string): Promise<{ enabled: boolean; message: string | null }> {
  const [org] = await db.select({ billingModule: organizations.billingModule }).from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return { enabled: false, message: "Organização não encontrada. Atualize a página ou entre em contato com o suporte." };
  if (org.billingModule !== "cobradora") return { enabled: false, message: "O recebimento Pix está disponível para organizações no plano CobraDora." };
  return { enabled: true, message: null };
}

export async function isXGateEnabledForOrganization(organizationId: string): Promise<boolean> {
  return (await getXGateOrganizationAvailability(organizationId)).enabled;
}

export async function getOrganizationCheckoutProvider(organizationId: string): Promise<"infinitepay" | "xgate"> {
  return (await isXGateEnabledForOrganization(organizationId)) ? "xgate" : "infinitepay";
}
