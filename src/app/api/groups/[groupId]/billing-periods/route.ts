import { NextRequest, NextResponse } from "next/server";
import { requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import { generateBillingPeriod } from "@/services/billing";
import { z } from "zod";

const generateInput = z.object({
  referenceMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    await requireOrganization();
    const { groupId } = await params;
    const { referenceMonth } = generateInput.parse(await request.json());
    const period = await generateBillingPeriod(groupId, referenceMonth);
    return NextResponse.json({ billingPeriod: period }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "generation_failed", message: (err as Error).message }, { status: 409 });
  }
}
