import { type Kysely, sql } from "kysely";
import type { Database } from "../db/db";
import type { Trx } from "../routes/common";

// Member erasure (AC-7.2) and session retention — specs/06, specs/07.

/** Deletes sessions (and their blocks, sets, reps) matching a condition on `sessions` alias `se`. */
async function deleteSessions(trx: Trx | Kysely<Database>, where: ReturnType<typeof sql>): Promise<number> {
  const ids = (await sql<{ id: string }>`select se.id from sessions se where ${where}`.execute(trx)).rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  await sql`delete from rep_events where set_id in (select s.id from sets s join session_blocks b on b.id = s.session_block_id where b.session_id = any(${ids}))`.execute(trx);
  await sql`delete from sets where session_block_id in (select id from session_blocks where session_id = any(${ids}))`.execute(trx);
  await sql`delete from session_blocks where session_id = any(${ids})`.execute(trx);
  await sql`delete from qr_tokens where session_id = any(${ids})`.execute(trx);
  await sql`delete from sessions where id = any(${ids})`.execute(trx);
  return ids.length;
}

/** Removes a member's data and anonymizes the member row (inside the tenant transaction). */
export async function eraseMember(trx: Trx, memberId: string): Promise<void> {
  await deleteSessions(trx, sql`se.member_id = ${memberId}`);
  await sql`delete from qr_tokens where member_id = ${memberId}`.execute(trx);
  await sql`delete from member_login_tokens where member_id = ${memberId}`.execute(trx);
  await sql`delete from auth_refresh_tokens where subject_kind = 'member' and subject_id = ${memberId}`.execute(trx);
  await sql`delete from trainer_members where member_id = ${memberId}`.execute(trx);
  await sql`delete from member_programs where member_id = ${memberId}`.execute(trx);
  await sql`update members set display_name = 'Silinmiş üye', email = null, phone = null, external_ref = null, branch_id = null,
              consent_at = null, consent_version = null, consent_withdrawn_at = null, status = 'anonymized'
            where id = ${memberId}`.execute(trx);
}

/** Purges sessions older than each gym's retention (default 24 months). Runs as the owner across tenants. */
export async function purgeExpiredSessions(db: Kysely<Database>, now: number): Promise<number> {
  return db.transaction().execute((trx) =>
    deleteSessions(
      trx,
      sql`se.started_at < ${new Date(now).toISOString()}::timestamptz
            - make_interval(months => coalesce((select retention_months from tenant_settings ts where ts.tenant_id = se.tenant_id), 24))`,
    ),
  );
}
