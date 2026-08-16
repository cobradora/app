import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByEmailForPasswordReset } from "@/services/auth";
import { createPasswordResetToken } from "@/lib/password-reset-token";
import { sendPasswordResetEmail } from "@/lib/email";

const forgotPasswordInput = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  try {
    const { email } = forgotPasswordInput.parse(await request.json());

    // Sempre responde sucesso, exista ou não a conta — evita que alguém
    // descubra quais e-mails estão cadastrados testando este endpoint.
    const user = await findUserByEmailForPasswordReset(email);
    if (user) {
      const token = await createPasswordResetToken(user.id);
      const appBaseUrl = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const resetUrl = `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      // Falha de envio não pode vazar (via erro/tempo de resposta) se a
      // conta existe — só loga para investigação, resposta continua ok.
      try {
        await sendPasswordResetEmail(email, resetUrl);
      } catch (emailError) {
        console.error("CobraDora: falha ao enviar e-mail de recuperação de senha", emailError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
