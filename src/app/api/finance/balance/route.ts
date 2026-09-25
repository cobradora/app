import { NextResponse } from "next/server";
import { requireOwnerOrAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { getOrganizationBalance, isOrganizationBalanceUnderReview } from "@/services/organization-ledger";

export async function GET() {
  try {
    const session = await requireOwnerOrAdmin();
    return NextResponse.json({ balance: await getOrganizationBalance(session.organizationId), underReview: await isOrganizationBalanceUnderReview(session.organizationId), feeRateBps: 300 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw error;
  }
}
