import { Kysely, PostgresDialect, type Transaction, sql } from "kysely";
import { type Migration, Migrator, NO_MIGRATIONS } from "kysely/migration";
import pg from "pg";
import * as m0001 from "./migrations/0001_init";
import * as m0002 from "./migrations/0002_auth";
import * as m0003 from "./migrations/0003_ingest";
import { APP_ROLE } from "./migrations/0001_init";

// Typed tables are added as API features land (T3.2+); until then queries use raw SQL.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }) });
}

const MIGRATIONS: Record<string, Migration> = { "0001_init": m0001, "0002_auth": m0002, "0003_ingest": m0003 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations work on any schema
type AnyDb = Kysely<any>;

function migrator(db: AnyDb) {
  return new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } });
}

async function run(result: Promise<{ error?: unknown }>) {
  const { error } = await result;
  if (error) throw error instanceof Error ? error : new Error(String(error));
}

export const migrateToLatest = (db: AnyDb) => run(migrator(db).migrateToLatest());
export const migrateDownAll = (db: AnyDb) => run(migrator(db).migrateTo(NO_MIGRATIONS));

/**
 * Runs `fn` in a transaction scoped to one tenant: `app.tenant_id` is set and
 * the role drops to gymspot_app, so RLS applies even if the connection user
 * could bypass it (specs/06 "satır düzeyi güvenlik").
 */
export async function withTenant<T>(db: Kysely<Database>, tenantId: string, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    await sql`set local role ${sql.raw(APP_ROLE)}`.execute(trx);
    return fn(trx);
  });
}

/** Runs as gymspot_app without a tenant: RLS hides every tenant row (for narrow SECURITY DEFINER lookups). */
export async function asAppRole<T>(db: Kysely<Database>, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`set local role ${sql.raw(APP_ROLE)}`.execute(trx);
    return fn(trx);
  });
}
