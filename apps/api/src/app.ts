import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { authRoutes } from "./auth/routes";
import { AccessTokens, TenantKeys } from "./auth/tokens";
import { type AppConfig, configFromEnv } from "./config";
import { meRoutes } from "./routes/me";
import { memberRoutes } from "./routes/members";
import { stationRoutes } from "./routes/stations";
import { templateRoutes } from "./routes/templates";
import type { Database } from "./db/db";

// REST API skeleton (specs/02): structured logs with request ids; business
// routes arrive with T3.2–T3.4. Logs never contain landmarks or video (specs/07).

export interface AppDeps {
  db: Kysely<Database>;
  config?: AppConfig;
  logger?: boolean;
}

export function buildApp({ db, config = configFromEnv(), logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger, requestIdHeader: "x-request-id", genReqId: () => crypto.randomUUID() });
  const tokens = new AccessTokens(config.jwtSecret, config.now);
  const keys = new TenantKeys(config.qrMasterSecret);

  void app.register(rateLimit, { global: false });
  void app.register(authRoutes({ db, config, tokens, keys }));
  void app.register(memberRoutes(db, config, tokens));
  void app.register(templateRoutes(db, tokens));
  void app.register(meRoutes(db, config, tokens));
  void app.register(stationRoutes(db, tokens));

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
