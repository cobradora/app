import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processXGateDepositInbox } from "@/services/xgate-deposit-inbox";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await processXGateDepositInbox();
  return NextResponse.json(result, { status: result.failures ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
