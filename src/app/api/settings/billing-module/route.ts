import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError, requireAdmin, requireOrganization, UnauthorizedError } from "@/lib/auth-context";
import {
  billingModuleSettingsInput,
  getBillingModuleSettings,
  OrganizerPhoneRequiredError,
  updateBillingModuleSettings,
} from "@/services/billing-modules";
import { z } from "zod";

export async function GET() {
  try {
    const session = await requireOrganization();
    const settings = await getBillingModuleSettings(session.organizationId);
    if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ settings });
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
    const input = billingModuleSettingsInput.parse(await request.json());
    const settings = await updateBillingModuleSettings(session.organizationId, session.userId, input);
    if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error instanceof OrganizerPhoneRequiredError) {
      return NextResponse.json(
        { error: "organizer_phone_required", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "validation_error", issues: error.issues }, { status: 400 });
    }
    throw error;
  }
}
