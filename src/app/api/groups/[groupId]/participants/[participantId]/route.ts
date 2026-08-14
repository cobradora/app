import { NextResponse } from "next/server";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/lib/auth-context";
import { unlinkParticipantFromGroup } from "@/services/participants";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string; participantId: string }> },
) {
  try {
    const session = await requireAdmin();
    const { groupId, participantId } = await params;
    const removed = await unlinkParticipantFromGroup(session.organizationId, groupId, participantId);
    if (!removed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "participant_has_outstanding_charges", message: (err as Error).message },
      { status: 409 },
    );
  }
}
