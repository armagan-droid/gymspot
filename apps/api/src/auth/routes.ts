import { DELEGATION_TTL_MS, signDelegation, toBase64Url, verifyQr } from "@gymspot/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type Kysely, type Transaction, sql } from "kysely";
import { z } from "zod";
import type { AppConfig } from "../config";
import { type Database, asAppRole, withTenant } from "../db/db";
import { tenantSettings } from "../routes/admin";
import { requireAuth } from "./guard";
import { createMagicLink } from "./magic-link";
import { burnPasswordCheck, verifyPassword } from "./password";
import {
  type AccessTokens,
  type AuthContext,
  PAIRING_CODE_TTL_MS,
  REFRESH_TTL_MS,
  type StaffRole,
  type SubjectKind,
  type TenantKeys,
  pairingCode,
  sha256,
  tenantOf,
  tenantToken,
} from "./tokens";

// Auth endpoints — specs/07 "Kimlik doğrulama", "Token ayrıntıları", "Check-in / devir QR".

const LOCK_AFTER = 5;
const LOCK_WINDOW_MS = 15 * 60_000;

interface Deps {
  db: Kysely<Database>;
  config: AppConfig;
  tokens: AccessTokens;
  keys: TenantKeys;
}

type Trx = Transaction<Database>;
const ts = (ms: number) => new Date(ms).toISOString();

function parse<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (!r.success) {
    void reply.code(400).send({ error: "invalid_request" });
    return undefined;
  }
  return r.data;
}

export function authRoutes({ db, config, tokens, keys }: Deps) {
  const now = config.now;
  const limited = { rateLimit: { max: config.authRateLimit, timeWindow: "1 minute" } };
  const audit = (trx: Trx, actor: string, action: string, target?: string) =>
    sql`insert into audit_log (tenant_id, actor, action, target, at)
        values (nullif(current_setting('app.tenant_id', true), '')::uuid, ${actor}, ${action}, ${target ?? null}, ${ts(now())})`.execute(trx);

  async function issue(trx: Trx, ctx: AuthContext) {
    const refreshToken = tenantToken(ctx.tid);
    await sql`insert into auth_refresh_tokens (tenant_id, subject_kind, subject_id, token_hash, expires_at)
              values (${ctx.tid}, ${ctx.kind}, ${ctx.sub}, ${sha256(refreshToken)}, ${ts(now() + REFRESH_TTL_MS)})`.execute(trx);
    return { accessToken: await tokens.sign(ctx), refreshToken };
  }

  return async function (app: FastifyInstance) {
    const staff = (roles?: StaffRole[]) => requireAuth(tokens, ["user"], roles);

    app.post("/auth/staff/login", { config: limited }, async (req, reply) => {
      const body = parse(z.object({ tenantId: z.uuid(), email: z.string().min(3), password: z.string().min(1) }), req.body, reply);
      if (!body) return;
      const email = body.email.trim().toLowerCase();
      const result = await withTenant(db, body.tenantId, async (trx) => {
        const tenant = (await sql`select 1 from tenants where status = 'active'`.execute(trx)).rows[0];
        if (!tenant) return (await burnPasswordCheck(body.password), "denied" as const);
        const attempt = (
          await sql<{ failed_count: number; window_started_at: Date; locked_until: Date | null }>`
            select failed_count, window_started_at, locked_until from login_attempts where email = ${email} for update`.execute(trx)
        ).rows[0];
        if (attempt?.locked_until && attempt.locked_until.getTime() > now()) return "locked" as const;

        const user = (
          await sql<{ id: string; password_hash: string; role: StaffRole }>`
            select id, password_hash, role from users where lower(email) = ${email} and status = 'active'`.execute(trx)
        ).rows[0];
        const ok = user ? await verifyPassword(user.password_hash, body.password) : (await burnPasswordCheck(body.password), false);
        if (!ok || !user) {
          const fresh = !attempt || attempt.window_started_at.getTime() + LOCK_WINDOW_MS < now() || attempt.locked_until !== null;
          const count = fresh ? 1 : attempt.failed_count + 1;
          const lockedUntil = count >= LOCK_AFTER ? ts(now() + LOCK_WINDOW_MS) : null;
          await sql`insert into login_attempts (tenant_id, email, failed_count, window_started_at, locked_until)
                    values (${body.tenantId}, ${email}, ${count}, ${fresh ? ts(now()) : attempt.window_started_at}, ${lockedUntil})
                    on conflict (tenant_id, email) do update set failed_count = excluded.failed_count,
                      window_started_at = excluded.window_started_at, locked_until = excluded.locked_until`.execute(trx);
          await audit(trx, `staff:${email}`, "login_failed");
          return "denied" as const;
        }
        await sql`delete from login_attempts where email = ${email}`.execute(trx);
        await audit(trx, `user:${user.id}`, "login_ok");
        return issue(trx, { sub: user.id, tid: body.tenantId, kind: "user", role: user.role });
      });
      if (result === "locked") return reply.code(429).send({ error: "locked" });
      if (result === "denied") return reply.code(401).send({ error: "invalid_credentials" });
      return result;
    });

    app.post("/auth/refresh", { config: limited }, async (req, reply) => {
      const body = parse(z.object({ refreshToken: z.string() }), req.body, reply);
      if (!body) return;
      const tid = tenantOf(body.refreshToken);
      if (!tid) return reply.code(401).send({ error: "unauthorized" });
      const result = await withTenant(db, tid, async (trx) => {
        const row = (
          await sql<{ id: string; subject_kind: SubjectKind; subject_id: string }>`
            update auth_refresh_tokens set revoked_at = ${ts(now())}
            where token_hash = ${sha256(body.refreshToken)} and revoked_at is null and expires_at > ${ts(now())}
            returning id, subject_kind, subject_id`.execute(trx)
        ).rows[0];
        if (!row) return null;
        let role: StaffRole | undefined;
        if (row.subject_kind === "user") {
          const u = (await sql<{ role: StaffRole }>`select role from users where id = ${row.subject_id} and status = 'active'`.execute(trx)).rows[0];
          if (!u) return null;
          role = u.role;
        } else if (row.subject_kind === "member") {
          const m = (await sql`select 1 from members where id = ${row.subject_id} and status = 'active'`.execute(trx)).rows[0];
          if (!m) return null;
        }
        return issue(trx, { sub: row.subject_id, tid, kind: row.subject_kind, ...(role && { role }) });
      });
      return result ?? reply.code(401).send({ error: "unauthorized" });
    });

    app.post("/auth/logout", async (req, reply) => {
      const body = parse(z.object({ refreshToken: z.string() }), req.body, reply);
      if (!body) return;
      const tid = tenantOf(body.refreshToken);
      if (tid) {
        await withTenant(db, tid, (trx) =>
          sql`update auth_refresh_tokens set revoked_at = ${ts(now())} where token_hash = ${sha256(body.refreshToken)} and revoked_at is null`.execute(trx),
        );
      }
      return reply.code(204).send();
    });

    app.post("/auth/member/magic-link", { config: limited }, async (req, reply) => {
      const body = parse(z.object({ tenantId: z.uuid(), email: z.string().min(3) }), req.body, reply);
      if (!body) return;
      const email = body.email.trim().toLowerCase();
      const created = await withTenant(db, body.tenantId, async (trx) => {
        const member = (await sql<{ id: string }>`select id from members where lower(email) = ${email} and status = 'active'`.execute(trx)).rows[0];
        return member ? createMagicLink(trx, body.tenantId, member.id, now()) : null;
      });
      if (created) await config.sendMagicLink(email, `${config.appBaseUrl}/member/login?token=${encodeURIComponent(created)}`, body.tenantId);
      // same answer either way: no account enumeration (specs/07)
      return reply.code(202).send({ status: "accepted" });
    });

    app.post("/auth/member/verify", { config: limited }, async (req, reply) => {
      const body = parse(z.object({ token: z.string() }), req.body, reply);
      if (!body) return;
      const tid = tenantOf(body.token);
      if (!tid) return reply.code(401).send({ error: "unauthorized" });
      const result = await withTenant(db, tid, async (trx) => {
        const row = (
          await sql<{ member_id: string }>`
            update member_login_tokens set used_at = ${ts(now())}
            where token_hash = ${sha256(body.token)} and used_at is null and expires_at > ${ts(now())}
            returning member_id`.execute(trx)
        ).rows[0];
        if (!row) return null;
        await audit(trx, `member:${row.member_id}`, "member_login");
        return issue(trx, { sub: row.member_id, tid, kind: "member" });
      });
      return result ?? reply.code(401).send({ error: "unauthorized" });
    });

    app.post("/stations/:stationId/pairing-code", { preHandler: staff(["owner", "manager"]) }, async (req, reply) => {
      const { stationId } = req.params as { stationId: string };
      const auth = req.auth!;
      if (!z.uuid().safeParse(stationId).success) return reply.code(404).send({ error: "not_found" });
      const code = pairingCode();
      const expiresAt = ts(now() + PAIRING_CODE_TTL_MS);
      const ok = await withTenant(db, auth.tid, async (trx) => {
        const station = (await sql`select 1 from stations where id = ${stationId}`.execute(trx)).rows[0];
        if (!station) return false;
        await sql`insert into device_pairing_codes (tenant_id, station_id, code_hash, expires_at, created_by)
                  values (${auth.tid}, ${stationId}, ${sha256(code)}, ${expiresAt}, ${auth.sub})`.execute(trx);
        await audit(trx, `user:${auth.sub}`, "pairing_code_created", `station:${stationId}`);
        return true;
      });
      return ok ? { code, expiresAt } : reply.code(404).send({ error: "not_found" });
    });

    app.post("/auth/device/pair", { config: limited }, async (req, reply) => {
      const body = parse(z.object({ code: z.string().min(4).max(16) }), req.body, reply);
      if (!body) return;
      const hash = sha256(body.code.trim().toUpperCase());
      const tid = await asAppRole(db, async (trx) =>
        (await sql<{ tid: string | null }>`select resolve_pairing_code(${hash}) as tid`.execute(trx)).rows[0]?.tid ?? null,
      );
      if (!tid) return reply.code(401).send({ error: "invalid_code" });
      const result = await withTenant(db, tid, async (trx) => {
        const code = (
          await sql<{ station_id: string; created_by: string | null }>`
            update device_pairing_codes set used_at = ${ts(now())}
            where code_hash = ${hash} and used_at is null and expires_at > ${ts(now())}
            returning station_id, created_by`.execute(trx)
        ).rows[0];
        if (!code) return null;
        const deviceToken = tenantToken(tid);
        const device = (
          await sql<{ id: string }>`insert into devices (tenant_id, station_id, kind, token_hash, last_seen_at)
                    values (${tid}, ${code.station_id}, 'tablet', ${sha256(deviceToken)}, ${ts(now())}) returning id`.execute(trx)
        ).rows[0]!;
        await audit(trx, `device:${device.id}`, "device_paired", `station:${code.station_id}`);
        return { deviceId: device.id, deviceToken, tenantId: tid, stationId: code.station_id };
      });
      return result ?? reply.code(401).send({ error: "invalid_code" });
    });

    app.post("/auth/device/session", { config: limited }, async (req, reply) => {
      const body = parse(z.object({ deviceToken: z.string() }), req.body, reply);
      if (!body) return;
      const tid = tenantOf(body.deviceToken);
      if (!tid) return reply.code(401).send({ error: "unauthorized" });
      const device = await withTenant(db, tid, async (trx) =>
        (
          await sql<{ id: string }>`update devices set last_seen_at = ${ts(now())} where token_hash = ${sha256(body.deviceToken)} returning id`.execute(trx)
        ).rows[0],
      );
      if (!device) return reply.code(401).send({ error: "unauthorized" });
      return { accessToken: await tokens.sign({ sub: device.id, tid, kind: "device" }) };
    });

    app.delete("/devices/:deviceId", { preHandler: staff(["owner", "manager"]) }, async (req, reply) => {
      const { deviceId } = req.params as { deviceId: string };
      const auth = req.auth!;
      if (!z.uuid().safeParse(deviceId).success) return reply.code(404).send({ error: "not_found" });
      const removed = await withTenant(db, auth.tid, async (trx) => {
        const r = await sql`delete from devices where id = ${deviceId}`.execute(trx);
        if (r.numAffectedRows) await audit(trx, `user:${auth.sub}`, "device_removed", `device:${deviceId}`);
        return Boolean(r.numAffectedRows);
      });
      return removed ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    });

    app.post("/auth/member/qr-delegation", { preHandler: requireAuth(tokens, ["member"]) }, async (req, reply) => {
      const body = parse(z.object({ publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), req.body, reply);
      if (!body) return;
      const auth = req.auth!;
      const member = await withTenant(db, auth.tid, async (trx) =>
        (
          await sql<{ consent: boolean }>`
            select (consent_at is not null and consent_withdrawn_at is null) as consent
            from members where id = ${auth.sub} and status = 'active'`.execute(trx)
        ).rows[0],
      );
      if (!member) return reply.code(401).send({ error: "unauthorized" });
      const { secretKey } = await keys.get(auth.tid);
      return signDelegation(
        { v: 1, tid: auth.tid, mid: auth.sub, pk: body.publicKey, consent: member.consent, exp: now() + DELEGATION_TTL_MS },
        secretKey,
      );
    });

    app.get("/auth/qr-public-key", { preHandler: requireAuth(tokens, ["device"]) }, async (req) => {
      const { publicKey } = await keys.get(req.auth!.tid);
      // the tablet also needs the gym's safety pause setting (specs/05, C8)
      const { safetyPause } = await withTenant(db, req.auth!.tid, tenantSettings);
      return { publicKey: toBase64Url(publicKey), safetyPause };
    });

    app.post("/auth/qr/redeem", { preHandler: requireAuth(tokens, ["device"]) }, async (req, reply) => {
      const body = parse(z.object({ qr: z.string().max(4096) }), req.body, reply);
      if (!body) return;
      const auth = req.auth!;
      const { publicKey } = await keys.get(auth.tid);
      const v = await verifyQr(body.qr, publicKey, now());
      if (!v.ok) return reply.code(401).send({ error: "invalid_qr", reason: v.reason });
      const { payload, delegation } = v;
      const result = await withTenant(db, auth.tid, async (trx) => {
        const member = (await sql`select 1 from members where id = ${payload.mid} and status = 'active'`.execute(trx)).rows[0];
        if (!member) return "unknown" as const;
        const inserted = await sql`
          insert into qr_tokens (tenant_id, member_id, session_id, jti, expires_at, used_at)
          values (${auth.tid}, ${payload.mid}, ${payload.sid}, ${payload.jti}, ${ts(payload.exp)}, ${ts(now())})
          on conflict (jti) do nothing`.execute(trx);
        if (!inserted.numAffectedRows) {
          await audit(trx, `device:${auth.sub}`, "qr_reuse_rejected", `member:${payload.mid}`);
          return "used" as const;
        }
        await audit(trx, `device:${auth.sub}`, "qr_redeemed", `member:${payload.mid}`);
        return "ok" as const;
      });
      if (result === "unknown") return reply.code(401).send({ error: "invalid_qr", reason: "unknown_member" });
      if (result === "used") return reply.code(409).send({ error: "invalid_qr", reason: "already_used" });
      return {
        memberId: payload.mid,
        cameraConsent: delegation.consent,
        cursor: { sessionId: payload.sid, blockIndex: payload.bi, setIndex: payload.si },
        block: payload.blk,
      };
    });
  };
}
