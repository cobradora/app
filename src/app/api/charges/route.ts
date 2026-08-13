import { NextRequest, NextResponse } from "next/server";
import { requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import { listOrganizationCharges } from "@/services/charges";

export async function GET(request: NextRequest) {
  try {
    const session = await requireOrganization();
    const referenceMonth = request.nextUrl.searchParams.get("referenceMonth");
    if (!referenceMonth || !/^\d{4}-\d{2}$/.test(referenceMonth)) {
      return NextResponse.json({ error: "validation_error", message: "referenceMonth inválido" }, { status: 400 });
    }

    const charges = await listOrganizationCharges(session.organizationId, referenceMonth);
    return NextResponse.json({ charges });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }
}
