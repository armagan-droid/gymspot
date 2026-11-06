import { type Kysely, sql } from "kysely";
import type { Database } from "../db/db";
import type { BlobStore } from "./store";

export const CALIBRATION_RETENTION_MS = 365 * 24 * 60 * 60_000;

/** Deletes recordings older than 12 months (specs/07). Runs as the owner (all tenants). */
export async function purgeExpiredRecordings(db: Kysely<Database>, store: BlobStore, now: number): Promise<number> {
  const cutoff = new Date(now - CALIBRATION_RETENTION_MS).toISOString();
  const rows = (
    await sql<{ storage_ref: string }>`delete from calibration_recordings where created_at < ${cutoff} returning storage_ref`.execute(db)
  ).rows;
  for (const r of rows) await store.delete(r.storage_ref);
  return rows.length;
}
