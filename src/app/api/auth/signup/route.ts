import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signUp, signUpInput } from "@/services/auth";
import { createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const input = signUpInput.parse(await request.json());

    const result = await signUp(input);
    if (!result) {
      return NextResponse.json({ error: "email_taken", message: "Já existe uma conta com esse email" }, { status: 409 });
    }
    const { organization, user } = result;

    const token = await createSession({
      userId: user.id,
      organizationId: organization.id,
      role: "owner",
    });

    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } }, { status: 201 });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    if ((err as { code?: string } | null)?.code === "23505") {
      return NextResponse.json({ error: "email_taken", message: "Já existe uma conta com esse email" }, { status: 409 });
    }
    throw err;
  }
}
