import { describe, it, expect, beforeEach } from "vitest";
import { db, pool } from "@/db";
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

  it("mantém nomes, índices e grants da outbox compatíveis com PostgreSQL e Supabase", async () => {
    const { rows: constraints } = await pool.query<{ conname: string; nameBytes: number }>(`
      SELECT conname, octet_length(conname) AS "nameBytes"
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.whatsapp_notifications'::regclass
    `);
    const constraintNames = constraints.map((constraint) => constraint.conname);

    expect(constraintNames).toContain("whatsapp_notifications_org_contact_fk");
    expect(constraintNames).toContain("whatsapp_notifications_kind_contact_check");
    expect(constraints.every((constraint) => constraint.nameBytes <= 63)).toBe(true);

    const { rows: indexes } = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
      AND tablename = 'whatsapp_notifications'
    `);
    const indexNames = indexes.map((targetIndex) => targetIndex.indexname);
    expect(indexNames).toContain("whatsapp_notifications_billing_period_idx");
    expect(indexNames).toContain("whatsapp_notifications_financial_contact_idx");

    const { rows: dataApiRoles } = await pool.query<{ rolname: string; hasDataPrivilege: boolean }>(`
      SELECT role.rolname,
        has_table_privilege(role.oid, 'public.whatsapp_notifications', 'SELECT')
        OR has_table_privilege(role.oid, 'public.whatsapp_notifications', 'INSERT')
        OR has_table_privilege(role.oid, 'public.whatsapp_notifications', 'UPDATE')
        OR has_table_privilege(role.oid, 'public.whatsapp_notifications', 'DELETE') AS "hasDataPrivilege"
      FROM pg_catalog.pg_roles role
      WHERE role.rolname IN ('anon', 'authenticated')
    `);
    expect(dataApiRoles.every((role) => !role.hasDataPrivilege)).toBe(true);
  });
});
