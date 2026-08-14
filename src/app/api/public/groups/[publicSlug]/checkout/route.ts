import { NextRequest, NextResponse } from "next/server";
import { createCheckoutForCharges, PublicCheckoutError } from "@/services/checkout";
import { z } from "zod";

const MAX_BODY_BYTES = 8 * 1024;
const checkoutInput = z
  .object({
    phone: z.string().min(10).max(20),
    chargeIds: z
      .array(z.string().uuid())
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, { message: "chargeIds não pode conter duplicatas" }),
    idempotencyKey: z.string().min(10).max(100).regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();

function noStoreJson(body: unknown, status: number) {
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

  try {
    const { publicSlug } = await params;
    const { phone, chargeIds, idempotencyKey } = checkoutInput.parse(JSON.parse(rawBody));
    const checkout = await createCheckoutForCharges(publicSlug, phone, chargeIds, idempotencyKey);
    return noStoreJson({ checkout }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return noStoreJson({ error: "invalid_json" }, 400);
    if (error instanceof z.ZodError) {
      return noStoreJson({ error: "validation_error", issues: error.issues }, 400);
    }
    if (error instanceof PublicCheckoutError) {
      return noStoreJson({ error: error.code, message: error.message }, error.status);
    }

    console.error("Checkout público: falha inesperada", error);
    return noStoreJson({ error: "checkout_failed", message: "Não foi possível iniciar o checkout" }, 500);
  }
}
