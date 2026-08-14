import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireOrganization, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import {
  addParticipantInput,
  addParticipantToGroup,
  listGroupParticipants,
  ParticipantNameConflictError,
} from "@/services/participants";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await requireOrganization();
    const { groupId } = await params;

    const participants = await listGroupParticipants(session.organizationId, groupId);
    if (!participants) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ participants });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await requireAdmin();
    const { groupId } = await params;
    const body = addParticipantInput.parse(await request.json());

    const result = await addParticipantToGroup(session.organizationId, groupId, body);
    if (!result) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof ParticipantNameConflictError) {
      return NextResponse.json({ error: "participant_name_conflict", message: err.message }, { status: 409 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
