import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { updateGroup, updateGroupInput, archiveGroup } from "@/services/groups";
import { z } from "zod";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await requireAdmin();
    const { groupId } = await params;
    const input = updateGroupInput.parse(await request.json());

    const group = await updateGroup(session.organizationId, groupId, input);
    if (!group) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ group });
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await requireAdmin();
    const { groupId } = await params;

    const group = await archiveGroup(session.organizationId, groupId);
    if (!group) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ group });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "group_has_outstanding_charges", message: (err as Error).message }, { status: 409 });
  }
}
