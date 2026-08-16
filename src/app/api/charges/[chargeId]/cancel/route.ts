import { NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { cancelCharge } from "@/services/charges";

export async function POST(_request: Request, { params }: { params: Promise<{ chargeId: string }> }) {
  try {
    const session = await requireAdmin();
    const { chargeId } = await params;

    await cancelCharge(session.organizationId, session.userId, chargeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "cancel_failed", message: (err as Error).message }, { status: 409 });
  }
}
