import { LandmarkSequenceSchema } from "@gymspot/shared";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import { type BlobStore, encryptBlob } from "../calibration/store";
import type { AppConfig } from "../config";
import { type Database, withTenant } from "../db/db";
import { auth, iso, notFound, parse } from "./common";

// Calibration consents and recordings (C10) — specs/07 "Kalibrasyon modu" (AC-7.5).

export function calibrationRoutes(db: Kysely<Database>, config: AppConfig, tokens: AccessTokens, store: BlobStore) {
  const managers = requireAuth(tokens, ["user"], ["owner", "manager"]);
  const uuid = z.uuid();

  return async function (app: FastifyInstance) {
    app.post("/calibration/consents", { preHandler: managers }, async (req, reply) => {
      const body = parse(
        z.object({ participantRef: z.string().trim().min(1).max(64), consentVersion: z.string().trim().min(1).max(32), consentedAt: z.iso.datetime() }),
        req.body,
        reply,
      );
      if (!body) return;
      const ctx = auth(req);
      const row = await withTenant(db, ctx.tid, async (trx) =>
        (
          await sql<{ id: string }>`insert into calibration_consents (tenant_id, participant_ref, consent_version, consented_at, recorded_by)
            values (${ctx.tid}, ${body.participantRef}, ${body.consentVersion}, ${body.consentedAt}, ${ctx.sub}) returning id`.execute(trx)
        ).rows[0]!,
      );
      return reply.code(201).send(row);
    });

    app.post("/calibration/recordings", { preHandler: managers, bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
      const body = parse(z.object({ consentId: z.uuid(), sequence: LandmarkSequenceSchema }), req.body, reply);
      if (!body) return;
      if (body.sequence.source !== "calibration") return reply.code(400).send({ error: "invalid_request", issues: ["sequence.source: must be calibration"] });
      const ctx = auth(req);
      const result = await withTenant(db, ctx.tid, async (trx) => {
        const consent = (await sql`select 1 from calibration_consents where id = ${body.consentId} and withdrawn_at is null`.execute(trx)).rows[0];
        if (!consent) return { error: "consent_required" as const };
        const exercise = (
          await sql<{ version: number }>`select max(version)::int as version from exercises where id = ${body.sequence.exerciseId}`.execute(trx)
        ).rows[0];
        if (!exercise?.version) return { error: "unknown_exercise" as const };
        const id = crypto.randomUUID();
        const storageRef = `${ctx.tid}/${id}.json.enc`;
        // stored before the row: a failed write leaves no dangling reference
        await store.put(storageRef, encryptBlob(Buffer.from(JSON.stringify(body.sequence)), config.calibrationKey, `${ctx.tid}/${id}`));
        await sql`insert into calibration_recordings (id, tenant_id, consent_id, exercise_id, exercise_version, labels_json, storage_ref, created_at)
                  values (${id}, ${ctx.tid}, ${body.consentId}, ${body.sequence.exerciseId}, ${exercise.version},
                          ${JSON.stringify(body.sequence.labels ?? { reps: [] })}::jsonb, ${storageRef}, ${iso(config.now())})`.execute(trx);
        await sql`insert into audit_log (tenant_id, actor, action, target) values (${ctx.tid}, ${`user:${ctx.sub}`}, 'calibration_recorded', ${`recording:${id}`})`.execute(trx);
        return { id };
      });
      if ("error" in result) return reply.code(result.error === "consent_required" ? 409 : 400).send(result);
      return reply.code(201).send(result);
    });

    app.get("/calibration/recordings", { preHandler: managers }, async (req) => {
      const ctx = auth(req);
      const rows = await withTenant(db, ctx.tid, (trx) =>
        sql<{ id: string; exercise_id: string; exercise_version: number; participant_ref: string; reps: number; created_at: Date }>`
          select r.id, r.exercise_id, r.exercise_version, c.participant_ref,
                 coalesce(jsonb_array_length(r.labels_json -> 'reps'), 0)::int as reps, r.created_at
          from calibration_recordings r join calibration_consents c on c.id = r.consent_id
          order by r.created_at desc`.execute(trx),
      );
      return rows.rows.map((r) => ({
        id: r.id,
        exerciseId: r.exercise_id,
        exerciseVersion: r.exercise_version,
        participantRef: r.participant_ref,
        reps: r.reps,
        createdAt: r.created_at.toISOString(),
      }));
    });

    app.post("/calibration/consents/:consentId/withdraw", { preHandler: managers }, async (req, reply) => {
      const { consentId } = req.params as { consentId: string };
      if (!uuid.safeParse(consentId).success) return notFound(reply);
      const ctx = auth(req);
      const refs = await withTenant(db, ctx.tid, async (trx) => {
        const updated = await sql`update calibration_consents set withdrawn_at = coalesce(withdrawn_at, ${iso(config.now())}) where id = ${consentId}`.execute(trx);
        if (!updated.numAffectedRows) return null;
        const deleted = (await sql<{ storage_ref: string }>`delete from calibration_recordings where consent_id = ${consentId} returning storage_ref`.execute(trx)).rows;
        await sql`insert into audit_log (tenant_id, actor, action, target) values (${ctx.tid}, ${`user:${ctx.sub}`}, 'calibration_consent_withdrawn', ${`consent:${consentId}`})`.execute(trx);
        return deleted.map((d) => d.storage_ref);
      });
      if (!refs) return notFound(reply);
      for (const ref of refs) await store.delete(ref);
      return reply.code(204).send();
    });
  };
}
