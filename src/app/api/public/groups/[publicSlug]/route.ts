import { NextResponse } from "next/server";
import { getGroupPublicSummary } from "@/services/groups";

export async function GET(_request: Request, { params }: { params: Promise<{ publicSlug: string }> }) {
  const { publicSlug } = await params;

  const group = await getGroupPublicSummary(publicSlug);
  if (!group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ group });
}
