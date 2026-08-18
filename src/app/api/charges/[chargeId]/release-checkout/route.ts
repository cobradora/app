import { NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { releaseStuckCheckoutForCharge } from "@/services/checkout";

export async function POST(_request: Request, { params }: { params: Promise<{ chargeId: string }> }) {
  try {
    const session = await requireAdmin();
    const { chargeId } = await params;

    await releaseStuckCheckoutForCharge(session.organizationId, chargeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "release_failed", message: (err as Error).message }, { status: 409 });
  }
}
