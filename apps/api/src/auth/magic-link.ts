import { sql } from "kysely";
import type { Trx } from "../routes/common";
import { MAGIC_LINK_TTL_MS, sha256, tenantToken } from "./tokens";

/** Creates a single-use, 15-minute magic link token for a member (specs/07). */
export async function createMagicLink(trx: Trx, tenantId: string, memberId: string, now: number): Promise<string> {
  const token = tenantToken(tenantId);
  await sql`insert into member_login_tokens (tenant_id, member_id, token_hash, expires_at)
            values (${tenantId}, ${memberId}, ${sha256(token)}, ${new Date(now + MAGIC_LINK_TTL_MS).toISOString()})`.execute(trx);
  return token;
}
