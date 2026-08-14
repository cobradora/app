import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireOrganization, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { createGroup, createGroupInput, listGroups } from "@/services/groups";
import { z } from "zod";

export async function GET() {
  try {
    const session = await requireOrganization();
    const groups = await listGroups(session.organizationId);
    return NextResponse.json({ groups });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = await request.json();
    const input = createGroupInput.parse(body);
    const group = await createGroup(session.organizationId, input);
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
