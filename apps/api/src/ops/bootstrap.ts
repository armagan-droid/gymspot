import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadRulePack } from "@gymspot/engine";
import { type Kysely, sql } from "kysely";
import { hashPassword } from "../auth/password";
import { purgeExpiredRecordings } from "../calibration/purge";
import type { BlobStore } from "../calibration/store";
import type { Database } from "../db/db";
import { purgeExpiredSessions } from "../privacy/erase";

// Operator tasks (T5.4). They run as the database owner, outside any tenant.

/** Upserts every exercises/*.json (validated) as a global rule pack. Returns the ids. */
export async function seedExercises(db: Kysely<Database>, dir: string): Promise<string[]> {
  const ids: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const { pack } = loadRulePack(raw); // throws on an invalid pack: nothing half-seeded
    await sql`insert into exercises (id, version, definition_json, status, tenant_id)
              values (${pack.id}, ${pack.version}, ${JSON.stringify(raw)}::jsonb, ${pack.status}, null)
              on conflict (id, version) do update set definition_json = excluded.definition_json, status = excluded.status
              where exercises.tenant_id is null`.execute(db);
    ids.push(pack.id);
  }
  return ids;
}

export interface BootstrapInput {
  name: string;
  ownerEmail: string;
  ownerPassword: string;
}

/** Creates a gym (tenant), its default settings and the first owner account. */
export async function bootstrapTenant(db: Kysely<Database>, input: BootstrapInput): Promise<{ tenantId: string; ownerId: string }> {
  if (!input.name.trim()) throw new Error("gym name is required");
  if (input.ownerPassword.length < 12) throw new Error("owner password must be at least 12 characters");
  const hash = await hashPassword(input.ownerPassword);
  return db.transaction().execute(async (trx) => {
    const { id: tenantId } = (await sql<{ id: string }>`insert into tenants (name) values (${input.name.trim()}) returning id`.execute(trx)).rows[0]!;
    await sql`insert into tenant_settings (tenant_id) values (${tenantId})`.execute(trx);
    const { id: ownerId } = (
      await sql<{ id: string }>`insert into users (tenant_id, email, password_hash, role) values (${tenantId}, ${input.ownerEmail.trim().toLowerCase()}, ${hash}, 'owner') returning id`.execute(trx)
    ).rows[0]!;
    await sql`insert into audit_log (tenant_id, actor, action, target) values (${tenantId}, 'platform', 'tenant_bootstrapped', ${`user:${ownerId}`})`.execute(trx);
    return { tenantId, ownerId };
  });
}

/** Retention jobs (specs/07): run once a day. */
export async function runDailyJobs(db: Kysely<Database>, store: BlobStore, now: number) {
  return { sessions: await purgeExpiredSessions(db, now), recordings: await purgeExpiredRecordings(db, store, now) };
}
