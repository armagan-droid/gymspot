import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { requireAuth } from "../auth/guard";
import type { AccessTokens } from "../auth/tokens";
import { type Database, withTenant } from "../db/db";
import { auth } from "./common";

// Rule packs for clients (specs/10 T6.3): global packs and the tenant's own,
// latest version of each. RLS limits rows to tenant_id null or the caller's tenant.

export function exerciseRoutes(db: Kysely<Database>, tokens: AccessTokens) {
  const anyone = requireAuth(tokens, ["user", "member", "device"]);

  return async function (app: FastifyInstance) {
    app.get("/exercises", { preHandler: anyone }, async (req) => {
      const rows = await withTenant(db, auth(req).tid, async (trx) =>
        (
          await sql<{ id: string; version: number; status: string; definition_json: unknown }>`
            select distinct on (id) id, version, status, definition_json
            from exercises order by id, version desc`.execute(trx)
        ).rows,
      );
      return rows.map((r) => ({ id: r.id, version: r.version, status: r.status, definition: r.definition_json }));
    });
  };
}
