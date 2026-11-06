import { scrubErrorEvent } from "@gymspot/shared";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import type { AppConfig } from "../config";
import { type Database, withTenant } from "../db/db";
import { auth, iso, parse } from "./common";

// Operations: device heartbeat and client error reports — specs/02 "Gözlemlenebilirlik".

export const HEARTBEAT_ONLINE_MS = 3 * 60_000;

export function opsRoutes(db: Kysely<Database>, config: AppConfig, tokens: AccessTokens) {
  return async function (app: FastifyInstance) {
    app.post("/devices/heartbeat", { preHandler: requireAuth(tokens, ["device"]) }, async (req, reply) => {
      const body = parse(
        z.object({
          appVersion: z.string().max(40).optional(),
          fps: z.number().min(0).max(120).optional(),
          queued: z.int().min(0).max(1_000_000).optional(),
        }),
        req.body ?? {},
        reply,
      );
      if (!body) return;
      const ctx = auth(req);
      const at = iso(config.now());
      await withTenant(db, ctx.tid, async (trx) => {
        const d = (await sql<{ station_id: string | null }>`update devices set last_seen_at = ${at} where id = ${ctx.sub} returning station_id`.execute(trx)).rows[0];
        if (d?.station_id) {
          await sql`update stations set last_heartbeat_at = ${at}, device_status = 'online' where id = ${d.station_id}`.execute(trx);
        }
      });
      req.log.info({ heartbeat: { device: ctx.sub, appVersion: body.appVersion, fps: body.fps, queued: body.queued } }, "device_heartbeat");
      return reply.code(204).send();
    });

    // Public on purpose (errors happen before sign-in too); rate limited and size capped.
    app.post(
      "/client-errors",
      { bodyLimit: 16 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const event = scrubErrorEvent((req.body ?? {}) as Record<string, unknown>);
        req.log.warn({ clientError: event }, "client_error");
        return reply.code(202).send({ status: "accepted" });
      },
    );
  };
}
