import { NextResponse } from "next/server";
import { requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import { listGroupCharges } from "@/services/charges";

export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await requireOrganization();
    const { groupId } = await params;

    const charges = await listGroupCharges(session.organizationId, groupId);
    if (!charges) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ charges });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }
}
