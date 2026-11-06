import Fastify, { type FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import type { Database } from "./db/db";

// REST API skeleton (specs/02): structured logs with request ids; business
// routes arrive with T3.2–T3.4. Logs never contain landmarks or video (specs/07).

export interface AppDeps {
  db: Kysely<Database>;
  logger?: boolean;
}

export function buildApp({ db, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger, requestIdHeader: "x-request-id", genReqId: () => crypto.randomUUID() });

  app.get("/health", async (_req, reply) => {
    try {
      await sql`select 1`.execute(db);
      return { status: "ok", db: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded", db: "unreachable" });
    }
  });

  return app;
}
