import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { truncateAll } from "../helpers/db";

describe("schema", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("insere e lê uma organization", async () => {
    const [inserted] = await db
      .insert(organizations)
      .values({ name: "Arena Martins" })
      .returning();

    expect(inserted.id).toBeDefined();
    expect(inserted.status).toBe("active");

    const rows = await db.select().from(organizations);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Arena Martins");
  });
});
