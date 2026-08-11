import { NextRequest, NextResponse } from "next/server";
import { requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import { registerManualSettlement, manualSettlementInput } from "@/services/manual-settlement";
import { z } from "zod";

export async function POST(request: NextRequest, { params }: { params: Promise<{ chargeId: string }> }) {
  try {
    const session = await requireOrganization();
    const { chargeId } = await params;
    const input = manualSettlementInput.parse(await request.json());

    await registerManualSettlement(session.organizationId, session.userId, chargeId, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "settlement_failed", message: (err as Error).message }, { status: 409 });
  }
}
