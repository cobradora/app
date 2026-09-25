import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerOrAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { registerPayoutProfile, XGatePayoutError } from "@/services/xgate-payouts";
import { XGateError } from "@/payments/xgate-client";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  try {
    const session = await requireOwnerOrAdmin();
    const input = await request.json();
    return reply({ profile: await registerPayoutProfile(session.organizationId, input) }, 200);
  } catch (error) {
    if (error instanceof UnauthorizedError) return reply({ error: "unauthorized" }, 401);
    if (error instanceof ForbiddenError) return reply({ error: "forbidden" }, 403);
    if (error instanceof XGatePayoutError) return reply({ error: error.code, message: error.message }, error.status);
    if (error instanceof z.ZodError) {
      const labels: Record<string, string> = { name: "Nome do titular", document: "CPF/CNPJ do titular", pixKey: "Chave Pix", pixKeyType: "Tipo de chave Pix", email: "E-mail", phone: "Celular" };
      const issues = error.issues.map(issue => {
        const field = String(issue.path[0] ?? "");
        const label = labels[field] ?? "Cadastro";
        const message = issue.code === "custom" ? issue.message : `${label}: confira o preenchimento e o formato informado.`;
        return { field, message: issue.code === "custom" && !message.startsWith(`${label}:`) ? `${label}: ${message}` : message };
      });
      return reply({ error: "invalid_payout_profile", message: issues[0]?.message ?? "Confira os dados do cadastro.", issues }, 400);
    }
    if (error instanceof SyntaxError) return reply({ error: "invalid_request", message: "Não foi possível ler o cadastro. Atualize a página e tente novamente." }, 400);
    console.error("POST /api/finance/payout-profile falhou:", error);
    // XGateError.message já é sanitizada (nunca expõe corpo/credenciais do provedor).
    if (error instanceof XGateError) return reply({ error: error.code, message: error.message }, 503);
    return reply({ message: "Não foi possível registrar a chave Pix agora. Tente novamente." }, 503);
  }
}
