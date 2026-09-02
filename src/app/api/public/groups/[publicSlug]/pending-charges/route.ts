import { NextRequest, NextResponse } from "next/server";
import { listPendingChargesByPhone } from "@/services/pending-charges";
import { assertTrustedOrigin } from "@/lib/origin-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isValidPhone, PHONE_INPUT_MAX_LENGTH } from "@/lib/phone";
import { z } from "zod";

const MAX_BODY_BYTES = 512;
// Mais restritivo que as outras rotas públicas: recebe telefone e devolve
// se há cobrança pendente — sem limite, dá pra enumerar números cadastrados.
const RATE_LIMIT_PER_MINUTE = 10;
const lookupInput = z.object({ phone: z.string().max(PHONE_INPUT_MAX_LENGTH).refine(isValidPhone) }).strict();

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicSlug: string }> }) {
  if (!assertTrustedOrigin(request)) {
    return noStoreJson({ error: "forbidden" }, 403);
  }
  if (!(await checkRateLimit(`pending-charges:${getClientIp(request)}`, RATE_LIMIT_PER_MINUTE, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store, max-age=0" } });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return noStoreJson({ error: "request_too_large" }, 413);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return noStoreJson({ error: "invalid_json" }, 400);
  }

  const input = lookupInput.safeParse(parsedJson);
  if (!input.success) {
    // Mesma forma de resposta de um telefone válido sem cobranças: não
    // confirma publicamente se o número existe na organização.
    return noStoreJson({ pending: [] });
  }

  const { publicSlug } = await params;
  const pending = await listPendingChargesByPhone(publicSlug, input.data.phone);
  return noStoreJson({ pending });
}
