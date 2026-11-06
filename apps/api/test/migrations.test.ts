import { sql } from "kysely";
import { afterAll, describe, expect, test } from "vitest";
import { createDb, migrateDownAll, migrateToLatest } from "../src/db/db";
import { createDatabase, dbUrl, dropDatabase } from "./global-setup";

// AC-6.3: migrations build from scratch and roll back completely.
const name = `gymspot_migtest_${Date.now()}`;
afterAll(() => dropDatabase(name));

async function tables(db: ReturnType<typeof createDb>) {
  const r = await sql<{ name: string }>`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_name not like 'kysely_%' order by 1`.execute(db);
  return r.rows.map((x) => x.name);
}

describe("AC-6.3: migrations", () => {
  test("up from scratch, down to nothing, up again", async () => {
    await createDatabase(name);
    const db = createDb(dbUrl(name));
    try {
      await migrateToLatest(db);
      const after = await tables(db);
      expect(after).toEqual(expect.arrayContaining(["tenants", "members", "sessions", "rep_events", "fault_summaries", "audit_log"]));

      await migrateDownAll(db);
      expect(await tables(db)).toEqual([]);

      await migrateToLatest(db);
      expect(await tables(db)).toEqual(after);
    } finally {
      await db.destroy();
    }
  });
});
