import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifyPassword } from "@/lib/password";
import { createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const input = loginInput.parse(await request.json());

    const [user] = await db.select().from(users).where(eq(users.email, input.email));

    // Mensagem genérica em qualquer caso de falha (email inexistente, sem
    // senha cadastrada, senha errada ou usuário inativo) — não dá pista de
    // qual parte está incorreta.
    if (!user || !user.passwordHash || user.status !== "active" || !(await verifyPassword(input.password, user.passwordHash))) {
      return NextResponse.json({ error: "invalid_credentials", message: "Email ou senha inválidos" }, { status: 401 });
    }

    const token = await createSession({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
    });

    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
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
    throw err;
  }
}
