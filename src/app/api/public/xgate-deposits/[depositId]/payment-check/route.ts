import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedOrigin } from "@/lib/origin-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPublicXGateDeposit, XGateDepositError } from "@/services/xgate-deposits";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request, { params }: { params: Promise<{ depositId: string }> }) {
  if (!assertTrustedOrigin(request)) return reply({ error: "forbidden" }, 403);
  try {
    const { depositId } = await params;
    if (!z.string().uuid().safeParse(depositId).success) return reply({ error: "not_found" }, 404);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    // Check capability before allocating rate-limit keys or making external calls.
    await getPublicXGateDeposit(depositId, token);
    if (!await checkRateLimit(`xgate-check:${depositId}`, 12, 60)) return reply({ message: "Aguarde alguns segundos." }, 429);
    return reply({ deposit: await getPublicXGateDeposit(depositId, token, true) });
  } catch (error) {
    if (error instanceof XGateDepositError) return reply({ message: error.message }, error.status);
    console.error("POST /api/public/xgate-deposits/[depositId]/payment-check falhou:", error);
    return reply({ message: "Confirmação indisponível. Tente novamente em instantes." }, 503);
  }
}
