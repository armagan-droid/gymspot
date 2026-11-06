import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import { createMagicLink } from "../auth/magic-link";
import type { AccessTokens } from "../auth/tokens";
import type { AppConfig } from "../config";
import { type Database, withTenant } from "../db/db";
import { type Trx, auth, canSeeMember, isUniqueViolation, notFound, parse } from "./common";

// Members, trainer assignments, member programs and sessions for staff (C4, C6) — specs/06.

export interface MemberRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  external_ref: string | null;
  branch_id: string | null;
  status: string;
  consent_version: string | null;
  camera_consent: boolean;
}

export const MEMBER_COLUMNS = sql`id, display_name, email, phone, external_ref, branch_id, status, consent_version,
  (consent_at is not null and consent_withdrawn_at is null) as camera_consent`;

export const memberDto = (m: MemberRow) => ({
  id: m.id,
  displayName: m.display_name,
  email: m.email,
  phone: m.phone,
  externalRef: m.external_ref,
  branchId: m.branch_id,
  status: m.status,
  cameraConsent: m.camera_consent,
  consentVersion: m.consent_version,
});

const MemberInput = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.email().max(254).optional(),
  phone: z.string().trim().min(5).max(32).optional(),
  externalRef: z.string().trim().max(64).optional(),
  branchId: z.uuid().optional(),
});

const sessionDto = (s: { id: string; workout_day_index: number; started_at: Date; ended_at: Date | null; status: string }) => ({
  id: s.id,
  workoutDayIndex: s.workout_day_index,
  startedAt: s.started_at.toISOString(),
  endedAt: s.ended_at?.toISOString() ?? null,
  status: s.status,
});

export const listSessions = (trx: Trx, memberId: string) =>
  sql<{ id: string; workout_day_index: number; started_at: Date; ended_at: Date | null; status: string }>`
    select id, workout_day_index, started_at, ended_at, status from sessions
    where member_id = ${memberId} order by started_at desc limit 200`
    .execute(trx)
    .then((r) => r.rows.map(sessionDto));

export function memberRoutes(db: Kysely<Database>, config: AppConfig, tokens: AccessTokens) {
  const staff = requireAuth(tokens, ["user"]);
  const managers = requireAuth(tokens, ["user"], ["owner", "manager"]);
  const uuid = z.uuid();

  return async function (app: FastifyInstance) {
    app.post("/members", { preHandler: managers }, async (req, reply) => {
      const body = parse(MemberInput.extend({ invite: z.boolean().optional() }), req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      try {
        const { member, link } = await withTenant(db, ctx.tid, async (trx) => {
          const row = (
            await sql<MemberRow>`insert into members (tenant_id, branch_id, display_name, email, phone, external_ref)
              values (${ctx.tid}, ${body.branchId ?? null}, ${body.displayName}, ${body.email?.toLowerCase() ?? null},
                      ${body.phone ?? null}, ${body.externalRef ?? null})
              returning ${MEMBER_COLUMNS}`.execute(trx)
          ).rows[0]!;
          const token = body.invite && row.email ? await createMagicLink(trx, ctx.tid, row.id, config.now()) : null;
          return { member: row, link: token };
        });
        if (link && member.email) await config.sendMagicLink(member.email, `${config.appBaseUrl}/member/login?token=${encodeURIComponent(link)}`, ctx.tid);
        return reply.code(201).send(memberDto(member));
      } catch (e) {
        if (isUniqueViolation(e)) return reply.code(409).send({ error: "email_taken" });
        throw e;
      }
    });

    app.get("/members", { preHandler: staff }, async (req, reply) => {
      const q = parse(z.object({ q: z.string().max(100).optional() }), req.query, reply);
      if (!q) return;
      const ctx = auth(req);
      const pattern = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const rows = await withTenant(db, ctx.tid, (trx) =>
        sql<MemberRow>`select ${MEMBER_COLUMNS} from members m
          where (${pattern}::text is null or m.display_name ilike ${pattern} or m.email ilike ${pattern})
            and (${ctx.role !== "trainer"} or exists (select 1 from trainer_members t where t.member_id = m.id and t.trainer_user_id = ${ctx.sub}))
          order by m.display_name limit 500`.execute(trx),
      );
      return rows.rows.map(memberDto);
    });

    app.get("/members/:memberId", { preHandler: staff }, async (req, reply) => {
      const { memberId } = req.params as { memberId: string };
      const ctx = auth(req);
      if (!uuid.safeParse(memberId).success) return notFound(reply);
      const row = await withTenant(db, ctx.tid, async (trx) =>
        (await canSeeMember(trx, ctx, memberId)) ? (await sql<MemberRow>`select ${MEMBER_COLUMNS} from members where id = ${memberId}`.execute(trx)).rows[0] : undefined,
      );
      return row ? memberDto(row) : notFound(reply);
    });

    app.patch("/members/:memberId", { preHandler: managers }, async (req, reply) => {
      const { memberId } = req.params as { memberId: string };
      const body = parse(MemberInput.partial().extend({ status: z.enum(["active", "inactive"]).optional() }), req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      if (!uuid.safeParse(memberId).success) return notFound(reply);
      try {
        const row = await withTenant(db, ctx.tid, async (trx) =>
          (
            await sql<MemberRow>`update members set
                display_name = coalesce(${body.displayName ?? null}, display_name),
                email = coalesce(${body.email?.toLowerCase() ?? null}, email),
                phone = coalesce(${body.phone ?? null}, phone),
                external_ref = coalesce(${body.externalRef ?? null}, external_ref),
                status = coalesce(${body.status ?? null}, status)
              where id = ${memberId} returning ${MEMBER_COLUMNS}`.execute(trx)
          ).rows[0],
        );
        return row ? memberDto(row) : notFound(reply);
      } catch (e) {
        if (isUniqueViolation(e)) return reply.code(409).send({ error: "email_taken" });
        throw e;
      }
    });

    const assignment = async (req: { params: unknown; auth?: unknown }, add: boolean) => {
      const { memberId, userId } = req.params as { memberId: string; userId: string };
      const ctx = req.auth as ReturnType<typeof auth>;
      if (!uuid.safeParse(memberId).success || !uuid.safeParse(userId).success) return false;
      return withTenant(db, ctx.tid, async (trx) => {
        const ok = (
          await sql`select 1 from members m, users u where m.id = ${memberId} and u.id = ${userId} and u.role = 'trainer'`.execute(trx)
        ).rows[0];
        if (!ok) return false;
        if (add) {
          await sql`insert into trainer_members (tenant_id, trainer_user_id, member_id) values (${ctx.tid}, ${userId}, ${memberId})
                    on conflict do nothing`.execute(trx);
        } else {
          await sql`delete from trainer_members where trainer_user_id = ${userId} and member_id = ${memberId}`.execute(trx);
        }
        return true;
      });
    };
    app.put("/members/:memberId/trainers/:userId", { preHandler: managers }, async (req, reply) =>
      (await assignment(req, true)) ? reply.code(204).send() : notFound(reply),
    );
    app.delete("/members/:memberId/trainers/:userId", { preHandler: managers }, async (req, reply) =>
      (await assignment(req, false)) ? reply.code(204).send() : notFound(reply),
    );

    app.post("/members/:memberId/programs", { preHandler: staff }, async (req, reply) => {
      const { memberId } = req.params as { memberId: string };
      const body = parse(z.object({ templateId: z.uuid(), startDate: z.iso.date(), endDate: z.iso.date().optional() }), req.body, reply);
      if (!body) return;
      const ctx = auth(req);
      if (!uuid.safeParse(memberId).success) return notFound(reply);
      const created = await withTenant(db, ctx.tid, async (trx) => {
        if (!(await canSeeMember(trx, ctx, memberId))) return null;
        if (!(await sql`select 1 from program_templates where id = ${body.templateId}`.execute(trx)).rows[0]) return null;
        return (
          await sql<{ id: string }>`insert into member_programs (tenant_id, member_id, template_id, assigned_by, start_date, end_date)
            values (${ctx.tid}, ${memberId}, ${body.templateId}, ${ctx.sub}, ${body.startDate}, ${body.endDate ?? null}) returning id`.execute(trx)
        ).rows[0]!;
      });
      return created ? reply.code(201).send(created) : notFound(reply);
    });

    app.get("/members/:memberId/programs", { preHandler: staff }, async (req, reply) => {
      const { memberId } = req.params as { memberId: string };
      const ctx = auth(req);
      if (!uuid.safeParse(memberId).success) return notFound(reply);
      const rows = await withTenant(db, ctx.tid, async (trx) =>
        (await canSeeMember(trx, ctx, memberId))
          ? (
              await sql<{ id: string; template_id: string | null; start_date: string; end_date: string | null }>`
                select id, template_id, start_date::text, end_date::text from member_programs
                where member_id = ${memberId} order by start_date desc`.execute(trx)
            ).rows
          : null,
      );
      return rows ? rows.map((r) => ({ id: r.id, templateId: r.template_id, startDate: r.start_date, endDate: r.end_date })) : notFound(reply);
    });

    app.get("/members/:memberId/sessions", { preHandler: staff }, async (req, reply) => {
      const { memberId } = req.params as { memberId: string };
      const ctx = auth(req);
      if (!uuid.safeParse(memberId).success) return notFound(reply);
      const rows = await withTenant(db, ctx.tid, async (trx) => ((await canSeeMember(trx, ctx, memberId)) ? listSessions(trx, memberId) : null));
      return rows ?? notFound(reply);
    });

  };
}
