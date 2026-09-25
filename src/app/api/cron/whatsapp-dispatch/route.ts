import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchWhatsappNotifications } from "@/services/whatsapp-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Dispatch only: never creates reminder campaigns or replays historical cycles. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Four sends with the existing eight-second HTTP timeout fit within the execution window.
  const summary = await dispatchWhatsappNotifications(undefined, 4);
  return NextResponse.json({ ok: summary.failures.length === 0, ...summary }, {
    status: summary.failures.length ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
