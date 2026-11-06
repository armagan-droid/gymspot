import {
  RepEventRecordSchema,
  SessionBlockRecordSchema,
  SessionRecordSchema,
  SetRecordSchema,
} from "@gymspot/shared";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens, AuthContext } from "../auth/tokens";
import { type Database, withTenant } from "../db/db";
import { type Trx, auth, parse } from "./common";

// Session record ingestion — specs/06 "Kayıt alımı", specs/03 "Kayıtlar".

const RecordInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("session"), data: SessionRecordSchema.extend({ memberId: z.uuid(), memberProgramId: z.uuid() }) }),
  z.strictObject({ kind: z.literal("session_block"), data: SessionBlockRecordSchema.extend({ stationId: z.uuid().optional() }) }),
  z.strictObject({ kind: z.literal("set"), data: SetRecordSchema }),
  z.strictObject({ kind: z.literal("rep"), data: RepEventRecordSchema }),
]);
type RecordInput = z.infer<typeof RecordInput>;

export type IngestStatus = "ok" | "duplicate" | "retry" | "rejected";
interface Result {
  id: string | null;
  kind: string | null;
  status: IngestStatus;
  reason?: string;
}

const ORDER = { session: 0, session_block: 1, set: 2, rep: 3 } as const;
export const MAX_BATCH = 500;

type Access = "ok" | "missing" | "forbidden";

/** Member: own sessions. Device: sessions handed off to the tenant by QR (specs/06). */
async function sessionAccess(trx: Trx, ctx: AuthContext, sessionId: string): Promise<Access> {
  const s = (await sql<{ member_id: string }>`select member_id from sessions where id = ${sessionId}`.execute(trx)).rows[0];
  if (ctx.kind === "member") return !s ? "missing" : s.member_id === ctx.sub ? "ok" : "forbidden";
  if (ctx.kind === "device") {
    const handedOff = (await sql`select 1 from qr_tokens where session_id = ${sessionId} limit 1`.execute(trx)).rows[0];
    return !handedOff ? "forbidden" : s ? "ok" : "missing";
  }
  return "forbidden";
}

const conflicted = async (trx: Trx, id: string) => Boolean((await sql`select 1 from ingest_conflicts where record_id = ${id}`.execute(trx)).rows[0]);

async function logConflict(trx: Trx, ctx: AuthContext, id: string, kind: string, reason: string) {
  await sql`insert into ingest_conflicts (tenant_id, record_id, kind, reason) values (${ctx.tid}, ${id}, ${kind}, ${reason})
            on conflict do nothing`.execute(trx);
  await sql`insert into audit_log (tenant_id, actor, action, target) values (${ctx.tid}, ${`${ctx.kind}:${ctx.sub}`}, 'ingest_conflict', ${`${kind}:${id}`})`.execute(trx);
}

async function recountSet(trx: Trx, setId: string) {
  await sql`update sets s set
      valid_reps = c.valid, faulty_reps = c.faulty, incomplete_reps = c.incomplete
    from (select count(*) filter (where outcome = 'valid')::int as valid,
                 count(*) filter (where outcome = 'faulty')::int as faulty,
                 count(*) filter (where outcome = 'incomplete')::int as incomplete
          from rep_events where set_id = ${setId}) c
    where s.id = ${setId} and (c.valid + c.faulty + c.incomplete) > 0`.execute(trx);
}

async function ingestOne(trx: Trx, ctx: AuthContext, r: RecordInput): Promise<Omit<Result, "id" | "kind">> {
  switch (r.kind) {
    case "session": {
      const d = r.data;
      if (ctx.kind !== "member" || d.memberId !== ctx.sub) return { status: "rejected", reason: "forbidden" };
      const rank = (col: string) => sql.raw(`(case ${col} when 'active' then 0 when 'paused' then 1 else 2 end)`);
      const row = (
        await sql<{ id: string }>`
          insert into sessions (id, tenant_id, member_id, member_program_id, workout_day_index, started_at, ended_at, status)
          values (${d.id}, ${ctx.tid}, ${d.memberId}, ${d.memberProgramId}, ${d.workoutDayIndex}, ${d.startedAt}, ${d.endedAt ?? null}, ${d.status})
          on conflict (id) do update set status = excluded.status, ended_at = coalesce(excluded.ended_at, sessions.ended_at)
            where sessions.member_id = excluded.member_id and ${rank("sessions.status")} < ${rank("excluded.status")}
          returning id`.execute(trx)
      ).rows[0];
      return { status: row ? "ok" : "duplicate" };
    }
    case "session_block": {
      const d = r.data;
      if ((await sql`select 1 from session_blocks where id = ${d.id}`.execute(trx)).rows[0]) return { status: "duplicate" };
      const access = await sessionAccess(trx, ctx, d.sessionId);
      if (access !== "ok") return access === "missing" ? { status: "retry", reason: "session_missing" } : { status: "rejected", reason: "forbidden" };
      const taken = (await sql`select 1 from session_blocks where session_id = ${d.sessionId} and position = ${d.position}`.execute(trx)).rows[0];
      if (taken) {
        await logConflict(trx, ctx, d.id, "session_block", "position_taken");
        return { status: "rejected", reason: "conflict" };
      }
      await sql`insert into session_blocks (id, tenant_id, session_id, position, exercise_id, exercise_version, planned_sets, executed_by_device_id, station_id, status)
                values (${d.id}, ${ctx.tid}, ${d.sessionId}, ${d.position}, ${d.exerciseId}, ${d.exerciseVersion}, ${d.plannedSets},
                        ${d.executedByDeviceId}, ${d.stationId ?? null}, ${d.status})`.execute(trx);
      return { status: "ok" };
    }
    case "set": {
      const d = r.data;
      if ((await sql`select 1 from sets where id = ${d.id}`.execute(trx)).rows[0]) return { status: "duplicate" };
      if (await conflicted(trx, d.sessionBlockId)) {
        await logConflict(trx, ctx, d.id, "set", "parent_conflict");
        return { status: "rejected", reason: "conflict" };
      }
      const block = (await sql<{ session_id: string }>`select session_id from session_blocks where id = ${d.sessionBlockId}`.execute(trx)).rows[0];
      if (!block) return { status: "retry", reason: "block_missing" };
      if ((await sessionAccess(trx, ctx, block.session_id)) !== "ok") return { status: "rejected", reason: "forbidden" };
      await sql`insert into sets (id, tenant_id, session_block_id, set_index, planned_reps, valid_reps, faulty_reps, incomplete_reps, source, view, below_target, started_at, ended_at)
                values (${d.id}, ${ctx.tid}, ${d.sessionBlockId}, ${d.setIndex}, ${d.plannedReps ?? null}, ${d.validReps}, ${d.faultyReps},
                        ${d.incompleteReps}, ${d.source}, ${d.view ?? null}, ${d.belowTarget}, ${d.startedAt}, ${d.endedAt})`.execute(trx);
      await recountSet(trx, d.id);
      return { status: "ok" };
    }
    case "rep": {
      const d = r.data;
      if ((await sql`select 1 from rep_events where id = ${d.id}`.execute(trx)).rows[0]) return { status: "duplicate" };
      if (await conflicted(trx, d.setId)) {
        await logConflict(trx, ctx, d.id, "rep", "parent_conflict");
        return { status: "rejected", reason: "conflict" };
      }
      const set = (
        await sql<{ session_id: string }>`select b.session_id from sets s join session_blocks b on b.id = s.session_block_id where s.id = ${d.setId}`.execute(trx)
      ).rows[0];
      if (!set) return { status: "retry", reason: "set_missing" };
      if ((await sessionAccess(trx, ctx, set.session_id)) !== "ok") return { status: "rejected", reason: "forbidden" };
      await sql`insert into rep_events (id, tenant_id, set_id, rep_index, outcome, duration_ms, faults)
                values (${d.id}, ${ctx.tid}, ${d.setId}, ${d.repIndex}, ${d.outcome}, ${d.durationMs}, ${d.faults})`.execute(trx);
      await recountSet(trx, d.setId);
      return { status: "ok" };
    }
  }
}

export function ingestRoutes(db: Kysely<Database>, tokens: AccessTokens) {
  return async function (app: FastifyInstance) {
    app.post("/ingest", { preHandler: requireAuth(tokens, ["member", "device"]), bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
      const body = parse(z.object({ records: z.array(z.unknown()).max(MAX_BATCH) }), req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      const results: Result[] = body.records.map(() => ({ id: null, kind: null, status: "rejected", reason: "invalid" }));
      const valid: { index: number; record: RecordInput }[] = [];
      body.records.forEach((raw, index) => {
        const p = RecordInput.safeParse(raw);
        if (p.success) valid.push({ index, record: p.data });
        else {
          const r = raw as { kind?: unknown; data?: { id?: unknown } } | null;
          results[index] = { id: typeof r?.data?.id === "string" ? r.data.id : null, kind: typeof r?.kind === "string" ? r.kind : null, status: "rejected", reason: "invalid" };
        }
      });
      // parents before children; stable within a kind
      valid.sort((a, b) => ORDER[a.record.kind] - ORDER[b.record.kind] || a.index - b.index);

      await withTenant(db, ctx.tid, async (trx) => {
        // children of a parent rejected in this batch are rejected too (otherwise they would retry forever)
        const rejected = new Set<string>();
        for (const { index, record } of valid) {
          const parent = record.kind === "set" ? record.data.sessionBlockId : record.kind === "rep" ? record.data.setId : null;
          if (parent && rejected.has(parent)) {
            rejected.add(record.data.id);
            results[index] = { id: record.data.id, kind: record.kind, status: "rejected", reason: "parent_rejected" };
            continue;
          }
          await sql`savepoint ingest_record`.execute(trx);
          try {
            const out = await ingestOne(trx, ctx, record);
            await sql`release savepoint ingest_record`.execute(trx);
            results[index] = { id: record.data.id, kind: record.kind, ...out };
            if (out.status === "rejected") rejected.add(record.data.id);
          } catch (e) {
            await sql`rollback to savepoint ingest_record`.execute(trx);
            req.log.warn({ err: e, kind: record.kind }, "ingest record failed");
            results[index] = { id: record.data.id, kind: record.kind, status: "rejected", reason: "invalid" };
            rejected.add(record.data.id);
          }
        }
      });
      return { results };
    });
  };
}
