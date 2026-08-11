import { NextRequest, NextResponse } from "next/server";
import { requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import { findOrCreateParticipantByPhone, linkParticipantToGroup } from "@/services/participants";
import { z } from "zod";

const addParticipantInput = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(8).max(30),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await requireOrganization();
    const { groupId } = await params;
    const body = addParticipantInput.parse(await request.json());

    const participant = await findOrCreateParticipantByPhone(session.organizationId, body.phone);
    await linkParticipantToGroup(groupId, participant.id);

    return NextResponse.json({ participant }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
