import { NextResponse } from "next/server";
import { requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import { unlinkParticipantFromGroup } from "@/services/participants";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string; participantId: string }> },
) {
  try {
    await requireOrganization();
    const { groupId, participantId } = await params;
    await unlinkParticipantFromGroup(groupId, participantId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "participant_has_outstanding_charges", message: (err as Error).message },
      { status: 409 },
    );
  }
}
