import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import { type Database, withTenant } from "../db/db";
import { type Trx, auth, notFound, parse } from "./common";

// Program templates (C5) — specs/03 Block, specs/06.

export const TemplateBlockInput = z
  .object({
    dayIndex: z.int().min(0).max(13),
    position: z.int().min(0).max(49),
    exerciseId: z.string().regex(/^[a-z][a-z0-9_]*$/),
    sets: z.int().min(1).max(20),
    reps: z.int().min(1).max(200).optional(),
    durationSec: z.int().min(1).max(3600).optional(),
    restSec: z.int().min(0).max(1800),
    mode: z.enum(["strict", "lenient"]),
    stationHint: z.string().trim().min(1).max(80).optional(),
  })
  .refine((b) => (b.reps === undefined) !== (b.durationSec === undefined), "exactly one of reps or durationSec");

const TemplateInput = z.object({ name: z.string().trim().min(1).max(120), blocks: z.array(TemplateBlockInput).min(1).max(100) });
type TemplateInput = z.infer<typeof TemplateInput>;

export interface BlockRow {
  day_index: number;
  position: number;
  exercise_id: string;
  sets: number;
  reps: number | null;
  duration_sec: number | null;
  rest_sec: number;
  mode: "strict" | "lenient";
  station_hint: string | null;
}

export const templateBlocks = (trx: Trx, templateId: string) =>
  sql<BlockRow>`select day_index, position, exercise_id, sets, reps, duration_sec, rest_sec, mode, station_hint
    from program_template_blocks where template_id = ${templateId} order by day_index, position`
    .execute(trx)
    .then((r) => r.rows);

const blockDto = (b: BlockRow) => ({
  dayIndex: b.day_index,
  position: b.position,
  exerciseId: b.exercise_id,
  sets: b.sets,
  ...(b.reps !== null && { reps: b.reps }),
  ...(b.duration_sec !== null && { durationSec: b.duration_sec }),
  restSec: b.rest_sec,
  mode: b.mode,
  ...(b.station_hint !== null && { stationHint: b.station_hint }),
});

/** Exercise ids not visible to this tenant (global or own rule packs). */
async function unknownExercises(trx: Trx, ids: string[]): Promise<string[]> {
  const found = (await sql<{ id: string }>`select distinct id from exercises where id = any(${ids})`.execute(trx)).rows.map((r) => r.id);
  return [...new Set(ids)].filter((id) => !found.includes(id));
}

async function writeBlocks(trx: Trx, tenantId: string, templateId: string, blocks: TemplateInput["blocks"]) {
  for (const b of blocks) {
    await sql`insert into program_template_blocks
        (tenant_id, template_id, day_index, position, exercise_id, sets, reps, duration_sec, rest_sec, mode, station_hint)
      values (${tenantId}, ${templateId}, ${b.dayIndex}, ${b.position}, ${b.exerciseId}, ${b.sets}, ${b.reps ?? null},
              ${b.durationSec ?? null}, ${b.restSec}, ${b.mode}, ${b.stationHint ?? null})`.execute(trx);
  }
}

export function templateRoutes(db: Kysely<Database>, tokens: AccessTokens) {
  const staff = requireAuth(tokens, ["user"]);
  const uuid = z.uuid();

  return async function (app: FastifyInstance) {
    app.post("/program-templates", { preHandler: staff }, async (req, reply) => {
      const body = parse(TemplateInput, req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        const unknown = await unknownExercises(trx, body.blocks.map((b) => b.exerciseId));
        if (unknown.length > 0) return { unknown };
        const { id } = (
          await sql<{ id: string }>`insert into program_templates (tenant_id, name, created_by) values (${ctx.tid}, ${body.name}, ${ctx.sub}) returning id`.execute(trx)
        ).rows[0]!;
        await writeBlocks(trx, ctx.tid, id, body.blocks);
        return { id };
      });
      if ("unknown" in result) return reply.code(400).send({ error: "unknown_exercise", exerciseIds: result.unknown });
      return reply.code(201).send(result);
    });

    app.get("/program-templates", { preHandler: staff }, async (req) => {
      const ctx = auth(req);
      const rows = await withTenant(db, ctx.tid, (trx) =>
        sql<{ id: string; name: string; blocks: number }>`select t.id, t.name, count(b.id)::int as blocks
          from program_templates t left join program_template_blocks b on b.template_id = t.id
          group by t.id order by t.name`.execute(trx),
      );
      return rows.rows.map((r) => ({ id: r.id, name: r.name, blockCount: r.blocks }));
    });

    app.get("/program-templates/:templateId", { preHandler: staff }, async (req, reply) => {
      const { templateId } = req.params as { templateId: string };
      const ctx = auth(req);
      if (!uuid.safeParse(templateId).success) return notFound(reply);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        const t = (await sql<{ id: string; name: string }>`select id, name from program_templates where id = ${templateId}`.execute(trx)).rows[0];
        return t ? { id: t.id, name: t.name, blocks: (await templateBlocks(trx, t.id)).map(blockDto) } : null;
      });
      return result ?? notFound(reply);
    });

    app.put("/program-templates/:templateId", { preHandler: staff }, async (req, reply) => {
      const { templateId } = req.params as { templateId: string };
      const body = parse(TemplateInput, req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      if (!uuid.safeParse(templateId).success) return notFound(reply);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        const updated = await sql`update program_templates set name = ${body.name} where id = ${templateId}`.execute(trx);
        if (!updated.numAffectedRows) return "missing" as const;
        const unknown = await unknownExercises(trx, body.blocks.map((b) => b.exerciseId));
        if (unknown.length > 0) return { unknown };
        await sql`delete from program_template_blocks where template_id = ${templateId}`.execute(trx);
        await writeBlocks(trx, ctx.tid, templateId, body.blocks);
        return "ok" as const;
      });
      if (result === "missing") return notFound(reply);
      if (typeof result === "object") return reply.code(400).send({ error: "unknown_exercise", exerciseIds: result.unknown });
      return { id: templateId };
    });

    app.delete("/program-templates/:templateId", { preHandler: staff }, async (req, reply) => {
      const { templateId } = req.params as { templateId: string };
      const ctx = auth(req);
      if (!uuid.safeParse(templateId).success) return notFound(reply);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        if ((await sql`select 1 from member_programs where template_id = ${templateId} limit 1`.execute(trx)).rows[0]) return "in_use" as const;
        const r = await sql`delete from program_templates where id = ${templateId}`.execute(trx);
        return r.numAffectedRows ? ("ok" as const) : ("missing" as const);
      });
      if (result === "in_use") return reply.code(409).send({ error: "template_in_use" });
      return result === "ok" ? reply.code(204).send() : notFound(reply);
    });
  };
}
