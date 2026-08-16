import { NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { renewGroupCycleManually, GroupCycleNotManualError } from "@/services/billing";

export async function POST(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await requireAdmin();
    const { groupId } = await params;
    const period = await renewGroupCycleManually(session.organizationId, groupId);
    if (!period) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ billingPeriod: period });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof GroupCycleNotManualError) {
      return NextResponse.json({ error: "cycle_not_manual", message: err.message }, { status: 409 });
    }
    throw err;
  }
}
