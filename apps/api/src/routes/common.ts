import type { FastifyReply, FastifyRequest } from "fastify";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { z } from "zod";
import type { AuthContext } from "../auth/tokens";
import type { Database } from "../db/db";

export type Trx = Transaction<Database>;

export function parse<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (!r.success) {
    void reply.code(400).send({ error: "invalid_request", issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    return undefined;
  }
  return r.data;
}

export const auth = (req: FastifyRequest): AuthContext => req.auth!;
export const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "not_found" });
export const iso = (ms: number) => new Date(ms).toISOString();

/** Postgres unique violation. */
export const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

/**
 * Whether the caller may see this member (specs/06): managers/owners see every
 * member of their tenant (RLS), trainers only members assigned to them.
 */
export async function canSeeMember(trx: Trx, ctx: AuthContext, memberId: string): Promise<boolean> {
  const row =
    ctx.role === "trainer"
      ? (await sql`select 1 from members m join trainer_members t on t.member_id = m.id
                   where m.id = ${memberId} and t.trainer_user_id = ${ctx.sub}`.execute(trx)).rows[0]
      : (await sql`select 1 from members where id = ${memberId}`.execute(trx)).rows[0];
  return Boolean(row);
}
