import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { groups, organizations } from "@/db/schema";
import { getOrganizationCheckoutProvider } from "@/payments/gateway-policy";
import InfinitePayGroupPage from "./infinitepay-group-page";

export const dynamic = "force-dynamic";

export default async function PublicGroupPage({ params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;
  const [group] = await db
    .select({ organizationId: groups.organizationId, status: groups.status })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(and(eq(groups.publicSlug, publicSlug), eq(organizations.status, "active")));

  if (!group) notFound();
  if (group.status === "active" && await getOrganizationCheckoutProvider(group.organizationId) === "xgate") {
    redirect(`/g/${encodeURIComponent(publicSlug)}/pix`);
  }

  // Keep the existing archived-group message and InfinitePay experience.
  return <InfinitePayGroupPage />;
}
