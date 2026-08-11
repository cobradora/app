import { db } from "@/db";
import { participants, groupParticipants } from "@/db/schema";
import { and, eq } from "drizzle-orm";

function normalizePhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return `+55${withoutCountry}`;
}

export async function findOrCreateParticipantByPhone(organizationId: string, rawPhone: string) {
  const phoneNormalized = normalizePhoneBR(rawPhone);

  const [existing] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.organizationId, organizationId), eq(participants.phoneNormalized, phoneNormalized)));

  if (existing) return existing;

  const [created] = await db
    .insert(participants)
    .values({
      organizationId,
      name: "",
      phoneNormalized,
      phoneDisplay: rawPhone,
    })
    .returning();

  return created;
}

export async function linkParticipantToGroup(groupId: string, participantId: string) {
  const [link] = await db
    .insert(groupParticipants)
    .values({ groupId, participantId, status: "active" })
    .returning();
  return link;
}

export async function unlinkParticipantFromGroup(groupId: string, participantId: string) {
  await db
    .update(groupParticipants)
    .set({ status: "left", leftAt: new Date() })
    .where(
      and(
        eq(groupParticipants.groupId, groupId),
        eq(groupParticipants.participantId, participantId),
        eq(groupParticipants.status, "active"),
      ),
    );
}
