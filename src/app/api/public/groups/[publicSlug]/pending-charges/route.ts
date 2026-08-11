import { NextRequest, NextResponse } from "next/server";
import { listPendingChargesByPhone } from "@/services/pending-charges";
import { z } from "zod";

const queryInput = z.object({ phone: z.string().min(8) });

export async function GET(request: NextRequest, { params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;
  const phone = request.nextUrl.searchParams.get("phone") ?? "";

  const parsed = queryInput.safeParse({ phone });
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }

  const pending = await listPendingChargesByPhone(publicSlug, parsed.data.phone);
  return NextResponse.json({ pending });
}
