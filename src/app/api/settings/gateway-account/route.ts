import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireOrganization, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { getInfinitePayAccount, setInfinitePayHandle, setInfinitePayHandleInput } from "@/services/gateway-accounts";
import { z } from "zod";

export async function GET() {
  try {
    const session = await requireOrganization();
    const account = await getInfinitePayAccount(session.organizationId);
    return NextResponse.json({ account });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const input = setInfinitePayHandleInput.parse(await request.json());

    const account = await setInfinitePayHandle(session.organizationId, input);
    return NextResponse.json({ account });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
