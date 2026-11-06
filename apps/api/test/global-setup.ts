import type { TestProject } from "vitest/node";
import pg from "pg";
import { createDb, migrateToLatest } from "../src/db/db";

// Creates a fresh, migrated database for this test run and drops it afterwards.
// Postgres is required: tests fail loudly instead of being skipped.
export const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:54329/postgres";

export function dbUrl(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function createDatabase(name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(`Postgres is not reachable at ${ADMIN_URL} — run \`docker compose up -d db\``, { cause: e });
  }
  await admin.query(`create database "${name}"`);
  await admin.end();
}

export async function dropDatabase(name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.end();
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const name = `gymspot_test_${Date.now()}`;
  await createDatabase(name);
  const db = createDb(dbUrl(name));
  await migrateToLatest(db);
  await db.destroy();
  project.provide("databaseUrl", dbUrl(name));
  return async () => dropDatabase(name);
}
