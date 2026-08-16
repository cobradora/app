import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPasswordWithToken } from "@/services/auth";
import { verifyPasswordResetToken } from "@/lib/password-reset-token";

const resetPasswordInput = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const input = resetPasswordInput.parse(await request.json());

    let userId: string;
    try {
      userId = await verifyPasswordResetToken(input.token);
    } catch {
      return NextResponse.json(
        { error: "invalid_token", message: "Link de recuperação inválido ou expirado" },
        { status: 400 },
      );
    }

    await resetPasswordWithToken(userId, input.newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
