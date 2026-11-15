import { safeLoadRulePack } from "@gymspot/engine";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import { type Database, withTenant } from "../db/db";
import { auth, notFound, parse } from "./common";

// Exercise designer (C11) — specs/11: the gym's own rule packs. A draft may be
// invalid (work in progress); publishing validates it and adds a new version.

export const GYM_EXERCISE_ID = /^t_[a-z0-9_]{2,40}$/;
const MAX_DEFINITION_BYTES = 64 * 1024;

const DraftInput = z.object({
  definition: z
    .record(z.string(), z.unknown())
    .refine((d) => Buffer.byteLength(JSON.stringify(d)) <= MAX_DEFINITION_BYTES, "definition larger than 64 KB"),
});

const issuesOf = (definition: unknown): string[] => {
  const r = safeLoadRulePack(definition);
  return r.success ? [] : r.issues;
};

type Name = { tr: string; en: string } | null;

export function exerciseDesignerRoutes(db: Kysely<Database>, tokens: AccessTokens) {
  const staff = requireAuth(tokens, ["user"]);
  const designers = requireAuth(tokens, ["user"], ["owner", "manager"]);

  return async function (app: FastifyInstance) {
    app.get("/admin/exercises", { preHandler: staff }, async (req) => {
      const rows = await withTenant(db, auth(req).tid, async (trx) =>
        (
          await sql<{ id: string; published: number | null; pname: Name; dname: Name; updated_at: Date | null }>`
            with published as (
              select id, max(version) as version from exercises where tenant_id is not null group by id
            ), ids as (select id from published union select id from exercise_drafts)
            select ids.id, p.version as published, e.definition_json->'name' as pname,
                   d.definition_json->'name' as dname, d.updated_at
            from ids
            left join published p on p.id = ids.id
            left join exercises e on e.id = p.id and e.version = p.version and e.tenant_id is not null
            left join exercise_drafts d on d.id = ids.id
            order by ids.id`.execute(trx)
        ).rows,
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.dname ?? r.pname,
        publishedVersion: r.published,
        draft: r.updated_at !== null,
        draftUpdatedAt: r.updated_at?.toISOString() ?? null,
      }));
    });

    app.get<{ Params: { id: string } }>("/admin/exercises/:id/draft", { preHandler: designers }, async (req, reply) => {
      const row = await withTenant(db, auth(req).tid, async (trx) =>
        (
          await sql<{ definition_json: unknown; updated_at: Date }>`
            select definition_json, updated_at from exercise_drafts where id = ${req.params.id}`.execute(trx)
        ).rows[0],
      );
      if (!row) return notFound(reply);
      return { definition: row.definition_json, issues: issuesOf(row.definition_json), updatedAt: row.updated_at.toISOString() };
    });

    app.put<{ Params: { id: string } }>("/admin/exercises/:id/draft", { preHandler: designers }, async (req, reply) => {
      const { id } = req.params;
      const body = parse(DraftInput, req.body, reply);
      if (!body) return;
      if (!GYM_EXERCISE_ID.test(id) || body.definition.id !== id) return reply.code(400).send({ error: "invalid_exercise_id" });
      const ctx = auth(req);
      await withTenant(db, ctx.tid, (trx) =>
        sql`insert into exercise_drafts (tenant_id, id, definition_json, updated_by, updated_at)
            values (${ctx.tid}, ${id}, ${JSON.stringify(body.definition)}::jsonb, ${ctx.sub}, now())
            on conflict (tenant_id, id) do update
              set definition_json = excluded.definition_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`.execute(trx),
      );
      return { issues: issuesOf(body.definition) };
    });

    app.delete<{ Params: { id: string } }>("/admin/exercises/:id/draft", { preHandler: designers }, async (req, reply) => {
      const deleted = await withTenant(db, auth(req).tid, async (trx) =>
        Number((await sql`delete from exercise_drafts where id = ${req.params.id}`.execute(trx)).numAffectedRows ?? 0),
      );
      return deleted ? reply.code(204).send() : notFound(reply);
    });

    app.post<{ Params: { id: string } }>("/admin/exercises/:id/publish", { preHandler: designers }, async (req, reply) => {
      const ctx = auth(req);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        const draft = (
          await sql<{ definition_json: Record<string, unknown> }>`
            select definition_json from exercise_drafts where id = ${req.params.id} for update`.execute(trx)
        ).rows[0];
        if (!draft) return null;
        const last = (
          await sql<{ v: number | null }>`select max(version) as v from exercises where id = ${req.params.id} and tenant_id is not null`.execute(trx)
        ).rows[0]!.v;
        const definition = { ...draft.definition_json, version: (last ?? 0) + 1, status: "draft" };
        const issues = issuesOf(definition);
        if (issues.length > 0) return { issues };
        await sql`insert into exercises (id, version, definition_json, status, tenant_id)
                  values (${req.params.id}, ${definition.version}, ${JSON.stringify(definition)}::jsonb, 'draft', ${ctx.tid})`.execute(trx);
        await sql`delete from exercise_drafts where id = ${req.params.id}`.execute(trx);
        return { version: definition.version };
      });
      if (!result) return notFound(reply);
      if ("issues" in result) return reply.code(400).send({ error: "invalid_rule_pack", issues: result.issues });
      return result;
    });
  };
}
