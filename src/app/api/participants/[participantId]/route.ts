import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import {
  ParticipantCheckoutInProgressError,
  ParticipantNameConflictError,
  updateParticipant,
  updateParticipantInput,
} from "@/services/participants";
import { z } from "zod";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ participantId: string }> }) {
  try {
    const session = await requireAdmin();
    const { participantId } = await params;
    const input = updateParticipantInput.parse(await request.json());

    const participant = await updateParticipant(session.organizationId, participantId, input);
    if (!participant) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ participant });
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
    if (err instanceof ParticipantCheckoutInProgressError) {
      return NextResponse.json({ error: "participant_checkout_in_progress", message: err.message }, { status: 409 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
