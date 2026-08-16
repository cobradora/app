import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import { changePassword, changePasswordInput, InvalidCurrentPasswordError } from "@/services/auth";

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireOrganization();
    const input = changePasswordInput.parse(await request.json());
    await changePassword(session.userId, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof InvalidCurrentPasswordError) {
      return NextResponse.json({ error: "invalid_current_password", message: err.message }, { status: 400 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
