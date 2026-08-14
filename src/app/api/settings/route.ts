import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ForbiddenError,
  requireAdmin,
  requireOrganization,
  UnauthorizedError,
} from "@/lib/auth-context";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
  updateOrganizationSettingsInput,
} from "@/services/organization-settings";

export async function GET() {
  try {
    const session = await requireOrganization();
    return NextResponse.json({ settings: await getOrganizationSettings(session.organizationId) });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAdmin();
    const input = updateOrganizationSettingsInput.parse(await request.json());
    return NextResponse.json({ settings: await updateOrganizationSettings(session.organizationId, input) });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: error.issues }, { status: 400 });
    }
    throw error;
  }
}
