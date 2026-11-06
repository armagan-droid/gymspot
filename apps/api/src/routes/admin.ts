import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import { hashPassword } from "../auth/password";
import type { AccessTokens } from "../auth/tokens";
import type { AppConfig } from "../config";
import { type Database, withTenant } from "../db/db";
import { eraseMember } from "../privacy/erase";
import { type Trx, auth, canSeeMember, isUniqueViolation, iso, notFound, parse } from "./common";

// Admin panel endpoints (C2, C6, C8) — specs/06 roles, specs/08.

export interface TenantSettings {
  defaultMode: "strict" | "lenient";
  retentionMonths: number;
  safetyPause: boolean;
}

export async function tenantSettings(trx: Trx): Promise<TenantSettings> {
  const r = (
    await sql<{ default_mode: "strict" | "lenient"; retention_months: number; safety_pause: boolean }>`
      select default_mode, retention_months, safety_pause from tenant_settings`.execute(trx)
  ).rows[0];
  return r
    ? { defaultMode: r.default_mode, retentionMonths: r.retention_months, safetyPause: r.safety_pause }
    : { defaultMode: "strict", retentionMonths: 24, safetyPause: true };
}

export function adminRoutes(db: Kysely<Database>, config: AppConfig, tokens: AccessTokens) {
  const staff = requireAuth(tokens, ["user"]);
  const managers = requireAuth(tokens, ["user"], ["owner", "manager"]);
  const owners = requireAuth(tokens, ["user"], ["owner"]);

  return async function (app: FastifyInstance) {
    app.get("/admin/overview", { preHandler: managers }, async (req) => {
      const ctx = auth(req);
      const today = iso(config.now()).slice(0, 10);
      return withTenant(db, ctx.tid, async (trx) => {
        const counts = (
          await sql<{ active: number; today: number }>`select
              count(*) filter (where status = 'active')::int as active,
              count(*) filter (where started_at::date = ${today}::date)::int as today
            from sessions`.execute(trx)
        ).rows[0]!;
        const stations = (
          await sql<{ id: string; name: string; devices: number; last_seen_at: Date | null }>`
            select s.id, s.name, count(d.id)::int as devices, max(d.last_seen_at) as last_seen_at
            from stations s left join devices d on d.station_id = s.id group by s.id order by s.name`.execute(trx)
        ).rows;
        return {
          activeSessions: counts.active,
          sessionsToday: counts.today,
          stations: stations.map((s) => ({ id: s.id, name: s.name, devices: s.devices, lastSeenAt: s.last_seen_at?.toISOString() ?? null })),
        };
      });
    });

    app.get("/members/:memberId/insights", { preHandler: staff }, async (req, reply) => {
      const { memberId } = req.params as { memberId: string };
      const ctx = auth(req);
      if (!z.uuid().safeParse(memberId).success) return notFound(reply);
      const since30 = iso(config.now() - 30 * 24 * 3600_000);
      const since56 = iso(config.now() - 56 * 24 * 3600_000);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        if (!(await canSeeMember(trx, ctx, memberId))) return null;
        const topFaults = (
          await sql<{ exercise_id: string; fault_id: string; count: number }>`
            select b.exercise_id, f.fault_id, count(*)::int as count
            from sessions se join session_blocks b on b.session_id = se.id join sets s on s.session_block_id = b.id
              join rep_events r on r.set_id = s.id cross join unnest(r.faults) as f(fault_id)
            where se.member_id = ${memberId} and se.started_at >= ${since30}
            group by 1, 2 order by count desc, f.fault_id limit 5`.execute(trx)
        ).rows.map((r) => ({ exerciseId: r.exercise_id, faultId: r.fault_id, count: r.count }));
        const weeklySessions = (
          await sql<{ week: string; sessions: number }>`
            select to_char(date_trunc('week', started_at), 'YYYY-MM-DD') as week, count(*)::int as sessions
            from sessions where member_id = ${memberId} and status = 'done' and started_at >= ${since56}
            group by 1 order by 1`.execute(trx)
        ).rows;
        return { topFaults, weeklySessions };
      });
      return result ?? notFound(reply);
    });

    app.get("/settings", { preHandler: staff }, async (req) => withTenant(db, auth(req).tid, tenantSettings));

    app.put("/settings", { preHandler: owners }, async (req, reply) => {
      const body = parse(
        z.object({ defaultMode: z.enum(["strict", "lenient"]), retentionMonths: z.int().min(1).max(120), safetyPause: z.boolean() }),
        req.body,
        reply,
      );
      if (!body) return;
      const ctx = auth(req);
      return withTenant(db, ctx.tid, async (trx) => {
        await sql`insert into tenant_settings (tenant_id, default_mode, retention_months, safety_pause)
                  values (${ctx.tid}, ${body.defaultMode}, ${body.retentionMonths}, ${body.safetyPause})
                  on conflict (tenant_id) do update set default_mode = excluded.default_mode,
                    retention_months = excluded.retention_months, safety_pause = excluded.safety_pause`.execute(trx);
        await sql`insert into audit_log (tenant_id, actor, action, target) values (${ctx.tid}, ${`user:${ctx.sub}`}, 'settings_updated', ${JSON.stringify(body)})`.execute(trx);
        return tenantSettings(trx);
      });
    });

    app.get("/users", { preHandler: owners }, async (req) => {
      const rows = await withTenant(db, auth(req).tid, (trx) =>
        sql<{ id: string; email: string; role: string; status: string }>`select id, email, role, status from users order by role, email`.execute(trx),
      );
      return rows.rows;
    });

    app.post("/users", { preHandler: owners }, async (req, reply) => {
      const body = parse(
        z.object({ email: z.email().max(254), role: z.enum(["owner", "manager", "trainer"]), password: z.string().min(12).max(200) }),
        req.body,
        reply,
      );
      if (!body) return;
      const ctx = auth(req);
      const hash = await hashPassword(body.password);
      try {
        const row = await withTenant(db, ctx.tid, async (trx) => {
          const u = (
            await sql<{ id: string }>`insert into users (tenant_id, email, password_hash, role) values (${ctx.tid}, ${body.email.toLowerCase()}, ${hash}, ${body.role}) returning id`.execute(trx)
          ).rows[0]!;
          await sql`insert into audit_log (tenant_id, actor, action, target) values (${ctx.tid}, ${`user:${ctx.sub}`}, 'user_created', ${`user:${u.id}`})`.execute(trx);
          return u;
        });
        return reply.code(201).send({ id: row.id, email: body.email.toLowerCase(), role: body.role });
      } catch (e) {
        if (isUniqueViolation(e)) return reply.code(409).send({ error: "email_taken" });
        throw e;
      }
    });

    /** Trainers for member assignment (C6): managers need them, /users stays owner-only (specs/06). */
    app.get("/trainers", { preHandler: managers }, async (req) => {
      const rows = await withTenant(db, auth(req).tid, (trx) =>
        sql<{ id: string; email: string }>`select id, email from users where role = 'trainer' and status = 'active' order by email`.execute(trx),
      );
      return rows.rows;
    });

    /** AC-7.2: carry out a member's deletion request. */
    app.post("/data-requests/:requestId/complete", { preHandler: managers }, async (req, reply) => {
      const { requestId } = req.params as { requestId: string };
      if (!z.uuid().safeParse(requestId).success) return notFound(reply);
      const ctx = auth(req);
      const ok = await withTenant(db, ctx.tid, async (trx) => {
        const request = (
          await sql<{ member_id: string }>`select member_id from data_requests where id = ${requestId} and kind = 'delete' and completed_at is null for update`.execute(trx)
        ).rows[0];
        if (!request) return false;
        await eraseMember(trx, request.member_id);
        await sql`update data_requests set completed_at = ${iso(config.now())} where id = ${requestId}`.execute(trx);
        await sql`insert into audit_log (tenant_id, actor, action, target) values (${ctx.tid}, ${`user:${ctx.sub}`}, 'member_erased', ${`member:${request.member_id}`})`.execute(trx);
        return true;
      });
      return ok ? reply.code(204).send() : notFound(reply);
    });

    app.get("/data-requests", { preHandler: managers }, async (req) => {
      const rows = await withTenant(db, auth(req).tid, (trx) =>
        sql<{ id: string; kind: string; member_id: string; display_name: string; requested_at: Date; completed_at: Date | null }>`
          select r.id, r.kind, r.member_id, m.display_name, r.requested_at, r.completed_at
          from data_requests r join members m on m.id = r.member_id order by r.requested_at`.execute(trx),
      );
      return rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        memberId: r.member_id,
        memberName: r.display_name,
        requestedAt: r.requested_at.toISOString(),
        completedAt: r.completed_at?.toISOString() ?? null,
      }));
    });
  };
}
