import { NextResponse } from "next/server";
import { getGroupPublicSummary } from "@/services/groups";
import { assertTrustedOrigin } from "@/lib/origin-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const RATE_LIMIT_PER_MINUTE = 30;

export async function GET(request: Request, { params }: { params: Promise<{ publicSlug: string }> }) {
  if (!assertTrustedOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await checkRateLimit(`group-summary:${getClientIp(request)}`, RATE_LIMIT_PER_MINUTE, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const { publicSlug } = await params;

  const group = await getGroupPublicSummary(publicSlug);
  if (!group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ group });
}
