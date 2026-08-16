import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendDailyPaymentReminders } from "@/services/whatsapp-reminders";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    console.error("CobraDora Cron: CRON_SECRET ausente ou curto demais");
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await sendDailyPaymentReminders();
  return NextResponse.json({ ok: summary.failures.length === 0, ...summary });
}
