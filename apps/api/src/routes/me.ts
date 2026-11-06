import type { Block, Workout } from "@gymspot/shared";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import type { AppConfig } from "../config";
import { type Database, withTenant } from "../db/db";
import { type Trx, auth, iso, notFound, parse } from "./common";
import { MEMBER_COLUMNS, type MemberRow, listSessions, memberDto } from "./members";
import { templateBlocks } from "./templates";

// Member self-service (B1–B4, B6) — specs/03 "Bugünün antrenmanı", specs/07 consent.

interface SetRow {
  id: string;
  session_block_id: string;
  set_index: number;
  planned_reps: number | null;
  valid_reps: number;
  faulty_reps: number;
  incomplete_reps: number;
  below_target: boolean;
  started_at: Date;
  ended_at: Date;
}

/** Blocks -> sets -> fault summaries (and reps for exports) of one session. */
async function sessionDetail(trx: Trx, sessionId: string, withReps: boolean) {
  const session = (
    await sql<{ id: string; workout_day_index: number; started_at: Date; ended_at: Date | null; status: string }>`
      select id, workout_day_index, started_at, ended_at, status from sessions where id = ${sessionId}`.execute(trx)
  ).rows[0];
  if (!session) return null;
  const blocks = (
    await sql<{ id: string; position: number; exercise_id: string; exercise_version: number; planned_sets: number; status: string }>`
      select id, position, exercise_id, exercise_version, planned_sets, status from session_blocks where session_id = ${sessionId} order by position`.execute(trx)
  ).rows;
  const sets = (
    await sql<SetRow>`select s.id, s.session_block_id, s.set_index, s.planned_reps, s.valid_reps, s.faulty_reps, s.incomplete_reps,
        s.below_target, s.started_at, s.ended_at
      from sets s join session_blocks b on b.id = s.session_block_id where b.session_id = ${sessionId} order by s.set_index`.execute(trx)
  ).rows;
  const faults = (
    await sql<{ set_id: string; fault_id: string; count: number }>`select f.set_id, f.fault_id, f.count from fault_summaries f
      join sets s on s.id = f.set_id join session_blocks b on b.id = s.session_block_id where b.session_id = ${sessionId}
      order by f.count desc, f.fault_id`.execute(trx)
  ).rows;
  const reps = withReps
    ? (
        await sql<{ set_id: string; rep_index: number; outcome: string; duration_ms: number; faults: string[] }>`
          select r.set_id, r.rep_index, r.outcome, r.duration_ms, r.faults from rep_events r
          join sets s on s.id = r.set_id join session_blocks b on b.id = s.session_block_id where b.session_id = ${sessionId}
          order by r.rep_index`.execute(trx)
      ).rows
    : [];
  return {
    id: session.id,
    workoutDayIndex: session.workout_day_index,
    startedAt: session.started_at.toISOString(),
    endedAt: session.ended_at?.toISOString() ?? null,
    status: session.status,
    blocks: blocks.map((b) => ({
      position: b.position,
      exerciseId: b.exercise_id,
      exerciseVersion: b.exercise_version,
      plannedSets: b.planned_sets,
      status: b.status,
      sets: sets
        .filter((s) => s.session_block_id === b.id)
        .map((s) => ({
          setIndex: s.set_index,
          plannedReps: s.planned_reps,
          validReps: s.valid_reps,
          faultyReps: s.faulty_reps,
          incompleteReps: s.incomplete_reps,
          belowTarget: s.below_target,
          startedAt: s.started_at.toISOString(),
          endedAt: s.ended_at.toISOString(),
          faults: faults.filter((f) => f.set_id === s.id).map((f) => ({ faultId: f.fault_id, count: f.count })),
          ...(withReps && {
            reps: reps
              .filter((r) => r.set_id === s.id)
              .map((r) => ({ repIndex: r.rep_index, outcome: r.outcome, durationMs: r.duration_ms, faults: r.faults })),
          }),
        })),
    })),
  };
}

export function meRoutes(db: Kysely<Database>, config: AppConfig, tokens: AccessTokens) {
  const member = requireAuth(tokens, ["member"]);

  return async function (app: FastifyInstance) {
    app.get("/me", { preHandler: member }, async (req, reply) => {
      const ctx = auth(req);
      const row = await withTenant(db, ctx.tid, async (trx) => (await sql<MemberRow>`select ${MEMBER_COLUMNS} from members where id = ${ctx.sub}`.execute(trx)).rows[0]);
      return row ? memberDto(row) : notFound(reply);
    });

    app.post("/me/consent", { preHandler: member }, async (req, reply) => {
      const body = parse(z.object({ version: z.string().trim().min(1).max(32) }), req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      await withTenant(db, ctx.tid, (trx) =>
        sql`update members set consent_at = ${iso(config.now())}, consent_version = ${body.version}, consent_withdrawn_at = null
            where id = ${ctx.sub}`.execute(trx),
      );
      return reply.code(204).send();
    });

    app.delete("/me/consent", { preHandler: member }, async (req, reply) => {
      const ctx = auth(req);
      await withTenant(db, ctx.tid, (trx) => sql`update members set consent_withdrawn_at = ${iso(config.now())} where id = ${ctx.sub}`.execute(trx));
      return reply.code(204).send();
    });

    app.get("/me/sessions", { preHandler: member }, async (req) => {
      const ctx = auth(req);
      return withTenant(db, ctx.tid, (trx) => listSessions(trx, ctx.sub));
    });

    app.get("/me/sessions/:sessionId", { preHandler: member }, async (req, reply) => {
      const { sessionId } = req.params as { sessionId: string };
      const ctx = auth(req);
      if (!z.uuid().safeParse(sessionId).success) return notFound(reply);
      const detail = await withTenant(db, ctx.tid, async (trx) => {
        const own = (await sql`select 1 from sessions where id = ${sessionId} and member_id = ${ctx.sub}`.execute(trx)).rows[0];
        return own ? sessionDetail(trx, sessionId, false) : null;
      });
      return detail ?? notFound(reply);
    });

    /** B5: weekly reps per exercise over the last 8 weeks. */
    app.get("/me/progress", { preHandler: member }, async (req) => {
      const ctx = auth(req);
      const since = iso(config.now() - 56 * 24 * 3600_000);
      const rows = await withTenant(db, ctx.tid, (trx) =>
        sql<{ week: string; exercise_id: string; valid: number; faulty: number; incomplete: number }>`
          select to_char(date_trunc('week', se.started_at), 'YYYY-MM-DD') as week, b.exercise_id,
                 sum(s.valid_reps)::int as valid, sum(s.faulty_reps)::int as faulty, sum(s.incomplete_reps)::int as incomplete
          from sessions se join session_blocks b on b.session_id = se.id join sets s on s.session_block_id = b.id
          where se.member_id = ${ctx.sub} and se.started_at >= ${since}
          group by 1, 2 order by 1, 2`.execute(trx),
      );
      return rows.rows.map((r) => ({
        week: r.week,
        exerciseId: r.exercise_id,
        valid: r.valid,
        faulty: r.faulty,
        incomplete: r.incomplete,
        cleanRatio: r.valid + r.faulty > 0 ? r.valid / (r.valid + r.faulty) : null,
      }));
    });

    /** specs/07: the member's own data as JSON. */
    app.get("/me/export", { preHandler: member }, async (req, reply) => {
      const ctx = auth(req);
      const data = await withTenant(db, ctx.tid, async (trx) => {
        const profile = (await sql<MemberRow>`select ${MEMBER_COLUMNS} from members where id = ${ctx.sub}`.execute(trx)).rows[0];
        if (!profile) return null;
        const programs = (
          await sql<{ id: string; template_id: string | null; start_date: string; end_date: string | null }>`
            select id, template_id, start_date::text, end_date::text from member_programs where member_id = ${ctx.sub}`.execute(trx)
        ).rows.map((p) => ({ id: p.id, templateId: p.template_id, startDate: p.start_date, endDate: p.end_date }));
        const ids = (await sql<{ id: string }>`select id from sessions where member_id = ${ctx.sub} order by started_at`.execute(trx)).rows;
        const sessions = [];
        for (const { id } of ids) sessions.push(await sessionDetail(trx, id, true));
        return { exportedAt: iso(config.now()), profile: memberDto(profile), programs, sessions };
      });
      if (!data) return notFound(reply);
      return reply.header("content-disposition", 'attachment; filename="gymspot-export.json"').send(data);
    });

    app.post("/me/data-requests", { preHandler: member }, async (req, reply) => {
      const body = parse(z.object({ kind: z.literal("delete") }), req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      await withTenant(db, ctx.tid, async (trx) => {
        const inserted = await sql`insert into data_requests (tenant_id, member_id, kind, requested_at)
            values (${ctx.tid}, ${ctx.sub}, 'delete', ${iso(config.now())})
            on conflict (member_id) where kind = 'delete' and completed_at is null do nothing`.execute(trx);
        if (inserted.numAffectedRows) {
          await sql`insert into audit_log (tenant_id, actor, action, target) values (${ctx.tid}, ${`member:${ctx.sub}`}, 'data_request_delete', ${`member:${ctx.sub}`})`.execute(trx);
        }
      });
      return reply.code(202).send({ status: "accepted" });
    });

    /** Active program as engine Workouts, one per day, plus the suggested next day. */
    app.get("/me/program", { preHandler: member }, async (req, reply) => {
      const ctx = auth(req);
      const today = iso(config.now()).slice(0, 10);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        const program = (
          await sql<{ id: string; template_id: string; name: string }>`
            select p.id, p.template_id, t.name from member_programs p join program_templates t on t.id = p.template_id
            where p.member_id = ${ctx.sub} and p.start_date <= ${today}::date and (p.end_date is null or p.end_date >= ${today}::date)
            order by p.start_date desc, p.id desc limit 1`.execute(trx)
        ).rows[0];
        if (!program) return null;
        const blocks = await templateBlocks(trx, program.template_id);
        const versions = new Map(
          (
            await sql<{ id: string; version: number }>`select id, max(version)::int as version from exercises
              where id = any(${[...new Set(blocks.map((b) => b.exercise_id))]}) group by id`.execute(trx)
          ).rows.map((r) => [r.id, r.version]),
        );
        const dayIndexes = [...new Set(blocks.map((b) => b.day_index))].sort((a, b) => a - b);
        const days: Workout[] = dayIndexes.map((day) => ({
          id: `${program.id}:${day}`,
          name: `${program.name} · ${day + 1}`,
          blocks: blocks
            .filter((b) => b.day_index === day)
            .map(
              (b): Block => ({
                exerciseId: b.exercise_id,
                exerciseVersion: versions.get(b.exercise_id) ?? 1,
                sets: b.sets,
                ...(b.reps !== null && { reps: b.reps }),
                ...(b.duration_sec !== null && { durationSec: b.duration_sec }),
                restSec: b.rest_sec,
                mode: b.mode,
                ...(b.station_hint !== null && { stationHint: b.station_hint }),
              }),
            ),
        }));
        const last = (
          await sql<{ workout_day_index: number }>`select workout_day_index from sessions
            where member_program_id = ${program.id} and status = 'done'
            order by coalesce(ended_at, started_at) desc limit 1`.execute(trx)
        ).rows[0];
        const lastPos = last ? dayIndexes.indexOf(last.workout_day_index) : -1;
        const nextDayIndex = dayIndexes[(lastPos + 1) % dayIndexes.length] ?? 0;
        return { memberProgramId: program.id, days, nextDayIndex };
      });
      return result ?? notFound(reply);
    });
  };
}
