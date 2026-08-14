import { NextRequest, NextResponse } from "next/server";
import { listPendingChargesByPhone } from "@/services/pending-charges";
import { z } from "zod";

const MAX_BODY_BYTES = 512;
const lookupInput = z.object({ phone: z.string().min(10).max(20) }).strict();

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicSlug: string }> }) {
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
