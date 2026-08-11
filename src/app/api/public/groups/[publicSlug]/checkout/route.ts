import { NextRequest, NextResponse } from "next/server";
import { createCheckoutForCharges } from "@/services/checkout";
import { z } from "zod";

const checkoutInput = z.object({
  phone: z.string().min(8),
  chargeIds: z.array(z.string().uuid()).min(1),
  idempotencyKey: z.string().min(10),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicSlug: string }> }) {
  try {
    const { publicSlug } = await params;
    const body = await request.json();
    const { phone, chargeIds, idempotencyKey } = checkoutInput.parse(body);

    const result = await createCheckoutForCharges(publicSlug, phone, chargeIds, idempotencyKey);
    return NextResponse.json({ checkout: result }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "checkout_failed", message: (err as Error).message }, { status: 409 });
  }
}
