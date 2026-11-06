import type { Block, Workout } from "@gymspot/shared";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import type { AppConfig } from "../config";
import { type Database, withTenant } from "../db/db";
import { auth, iso, notFound, parse } from "./common";
import { MEMBER_COLUMNS, type MemberRow, listSessions, memberDto } from "./members";
import { templateBlocks } from "./templates";

// Member self-service (B1–B4, B6) — specs/03 "Bugünün antrenmanı", specs/07 consent.

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
