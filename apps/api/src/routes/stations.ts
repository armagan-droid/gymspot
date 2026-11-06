import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import { type Database, withTenant } from "../db/db";
import { auth, parse } from "./common";

// Stations (C3) — specs/06 "İstasyon/cihaz yönetimi": managers and owners.

export function stationRoutes(db: Kysely<Database>, tokens: AccessTokens) {
  const staff = requireAuth(tokens, ["user"]);
  const managers = requireAuth(tokens, ["user"], ["owner", "manager"]);

  return async function (app: FastifyInstance) {
    app.post("/stations", { preHandler: managers }, async (req, reply) => {
      const body = parse(
        z.object({
          name: z.string().trim().min(1).max(80),
          branchId: z.uuid().optional(),
          exerciseIds: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(20).optional(),
        }),
        req.body,
        reply,
      );
      if (!body) return;
      const ctx = auth(req);
      const row = await withTenant(db, ctx.tid, async (trx) =>
        (
          await sql<{ id: string }>`insert into stations (tenant_id, branch_id, name, exercise_ids)
            values (${ctx.tid}, ${body.branchId ?? null}, ${body.name}, ${body.exerciseIds ?? []}) returning id`.execute(trx)
        ).rows[0]!,
      );
      return reply.code(201).send(row);
    });

    app.get("/stations", { preHandler: staff }, async (req) => {
      const ctx = auth(req);
      const { stations, devices } = await withTenant(db, ctx.tid, async (trx) => ({
        stations: (
          await sql<{ id: string; name: string; exercise_ids: string[]; device_status: string; last_heartbeat_at: Date | null }>`
            select id, name, exercise_ids, device_status, last_heartbeat_at from stations order by name`.execute(trx)
        ).rows,
        devices: (
          await sql<{ id: string; station_id: string | null; kind: string; last_seen_at: Date | null }>`
            select id, station_id, kind, last_seen_at from devices order by last_seen_at desc nulls last`.execute(trx)
        ).rows,
      }));
      return stations.map((s) => ({
        id: s.id,
        name: s.name,
        exerciseIds: s.exercise_ids,
        deviceStatus: s.device_status,
        lastHeartbeatAt: s.last_heartbeat_at?.toISOString() ?? null,
        devices: devices
          .filter((d) => d.station_id === s.id)
          .map((d) => ({ id: d.id, kind: d.kind, lastSeenAt: d.last_seen_at?.toISOString() ?? null })),
      }));
    });
  };
}
