import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { type Database, createDb, withTenant } from "../src/db/db";
import { TENANT_TABLES } from "../src/db/migrations/0001_init";
import { AUTH_TENANT_TABLES } from "../src/db/migrations/0002_auth";

// AC-6.1 at the database level: RLS alone (no WHERE tenant filters in these
// queries) keeps tenants apart.

let db: Kysely<Database>;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const memberA = "a0000000-0000-4000-8000-000000000001";
const memberB = "b0000000-0000-4000-8000-000000000001";
const setB = "b0000000-0000-4000-8000-0000000000c3";

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
  // seeded as the (superuser) owner, which bypasses RLS; one statement per query (bind parameters)
  const sessionB = "b0000000-0000-4000-8000-0000000000a1";
  const blockB = "b0000000-0000-4000-8000-0000000000b2";
  for (const q of [
    sql`truncate tenants, exercises cascade`,
    sql`insert into tenants (id, name) values (${A}, 'Salon A'), (${B}, 'Salon B')`,
    sql`insert into members (id, tenant_id, display_name) values (${memberA}, ${A}, 'Ayşe'), (${memberB}, ${B}, 'Burak')`,
    sql`insert into exercises (id, version, definition_json, status, tenant_id) values
          ('squat', 1, '{}', 'draft', null), ('b_private', 1, '{}', 'draft', ${B})`,
    sql`insert into sessions (id, tenant_id, member_id, workout_day_index, started_at, status)
          values (${sessionB}, ${B}, ${memberB}, 0, now(), 'done')`,
    sql`insert into session_blocks (id, tenant_id, session_id, position, exercise_id, exercise_version, planned_sets, executed_by_device_id, status)
          values (${blockB}, ${B}, ${sessionB}, 0, 'squat', 1, 1, 'd', 'done')`,
    sql`insert into sets (id, tenant_id, session_block_id, set_index, valid_reps, faulty_reps, incomplete_reps, source, below_target, started_at, ended_at)
          values (${setB}, ${B}, ${blockB}, 0, 1, 1, 0, 'camera', false, now(), now())`,
    sql`insert into rep_events (id, tenant_id, set_id, rep_index, outcome, duration_ms, faults) values
          ('b0000000-0000-4000-8000-0000000000d4', ${B}, ${setB}, 0, 'faulty', 1500, '{knee_valgus}'),
          ('b0000000-0000-4000-8000-0000000000d5', ${B}, ${setB}, 1, 'valid', 1500, '{knee_valgus}')`,
  ]) {
    await q.execute(db);
  }
});

afterAll(async () => db.destroy());

describe("AC-6.1: tenant isolation by RLS", () => {
  test("a tenant only sees its own members", async () => {
    const rows = await withTenant(db, A, (trx) => sql<{ id: string }>`select id from members`.execute(trx));
    expect(rows.rows.map((r) => r.id)).toEqual([memberA]);
  });

  test("another tenant's row is invisible even by id", async () => {
    const rows = await withTenant(db, A, (trx) => sql`select * from members where id = ${memberB}`.execute(trx));
    expect(rows.rows).toEqual([]);
  });

  test("another tenant's rows cannot be updated or deleted", async () => {
    const upd = await withTenant(db, A, (trx) => sql`update members set display_name = 'x' where id = ${memberB}`.execute(trx));
    const del = await withTenant(db, A, (trx) => sql`delete from members where id = ${memberB}`.execute(trx));
    expect(upd.numAffectedRows).toBe(0n);
    expect(del.numAffectedRows).toBe(0n);
    const still = await sql<{ display_name: string }>`select display_name from members where id = ${memberB}`.execute(db);
    expect(still.rows[0]!.display_name).toBe("Burak");
  });

  test("writing a row for another tenant is rejected", async () => {
    await expect(
      withTenant(db, A, (trx) => sql`insert into members (tenant_id, display_name) values (${B}, 'sızma')`.execute(trx)),
    ).rejects.toThrow(/row-level security/);
  });

  test("without a tenant context nothing is visible", async () => {
    const rows = await db.transaction().execute(async (trx) => {
      await sql`set local role gymspot_app`.execute(trx);
      return sql`select * from members`.execute(trx);
    });
    expect(rows.rows).toEqual([]);
  });

  test("tenants see only themselves", async () => {
    const rows = await withTenant(db, A, (trx) => sql<{ name: string }>`select name from tenants`.execute(trx));
    expect(rows.rows.map((r) => r.name)).toEqual(["Salon A"]);
  });

  test("global rule packs are shared, tenant packs are private", async () => {
    const a = await withTenant(db, A, (trx) => sql<{ id: string }>`select id from exercises order by id`.execute(trx));
    const b = await withTenant(db, B, (trx) => sql<{ id: string }>`select id from exercises order by id`.execute(trx));
    expect(a.rows.map((r) => r.id)).toEqual(["squat"]);
    expect(b.rows.map((r) => r.id)).toEqual(["b_private", "squat"]);
    await expect(
      withTenant(db, A, (trx) => sql`update exercises set status = 'calibrated' where id = 'squat'`.execute(trx)),
    ).resolves.toMatchObject({ numAffectedRows: 0n }); // global packs are read-only for tenants
  });

  test("the derived fault_summaries view honours RLS", async () => {
    const a = await withTenant(db, A, (trx) => sql`select * from fault_summaries`.execute(trx));
    const b = await withTenant(db, B, (trx) => sql<{ fault_id: string; count: number }>`select fault_id, count from fault_summaries`.execute(trx));
    expect(a.rows).toEqual([]);
    expect(b.rows).toEqual([{ fault_id: "knee_valgus", count: 2 }]);
  });

  test("every table with a tenant_id column has forced RLS and a policy", async () => {
    const r = await sql<{ table: string; rls: boolean; forced: boolean; policies: number }>`
      select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c
      join information_schema.columns col on col.table_name = c.relname and col.column_name = 'tenant_id'
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
      order by c.relname`.execute(db);
    expect(r.rows.length).toBe(TENANT_TABLES.length + AUTH_TENANT_TABLES.length + 3); // + exercises, ingest_conflicts, data_requests
    for (const row of r.rows) expect(row, row.table).toMatchObject({ rls: true, forced: true });
    for (const row of r.rows) expect(row.policies, row.table).toBeGreaterThan(0);
  });
});
