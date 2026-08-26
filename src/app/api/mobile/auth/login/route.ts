import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";

const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Login do app mobile: mesma verificação do login web
 * (src/app/api/auth/login/route.ts), mas devolve o token no corpo da
 * resposta em vez de Set-Cookie — o app guarda o token em armazenamento
 * seguro do device e manda como `Authorization: Bearer` nas próximas
 * chamadas.
 */
export async function POST(request: NextRequest) {
  try {
    const input = loginInput.parse(await request.json());

    const [user] = await db.select().from(users).where(eq(users.email, input.email));

    if (!user || !user.passwordHash || user.status !== "active" || !(await verifyPassword(input.password, user.passwordHash))) {
      return NextResponse.json({ error: "invalid_credentials", message: "Email ou senha inválidos" }, { status: 401 });
    }

    const token = await createSession({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
    });

    return NextResponse.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
