import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerOrAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { requestWithdrawal, XGatePayoutError } from "@/services/xgate-payouts";
import { XGateError } from "@/payments/xgate-client";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  try {
    const session = await requireOwnerOrAdmin();
    const input = await request.json();
    return reply({ withdrawal: await requestWithdrawal(session.organizationId, input) }, 201);
  } catch (error) {
    if (error instanceof UnauthorizedError) return reply({ error: "unauthorized" }, 401);
    if (error instanceof ForbiddenError) return reply({ error: "forbidden" }, 403);
    if (error instanceof XGatePayoutError) return reply({ error: error.code, message: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ message: "Confira o valor do saque." }, 400);
    console.error("POST /api/finance/withdrawals falhou:", error);
    if (error instanceof XGateError) return reply({ error: error.code, message: error.message }, 503);
    return reply({ message: "Não foi possível solicitar o saque agora. Tente novamente." }, 503);
  }
}
