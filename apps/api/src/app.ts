import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { type Kysely, sql } from "kysely";
import { authRoutes } from "./auth/routes";
import { AccessTokens, TenantKeys } from "./auth/tokens";
import { type BlobStore, FileBlobStore } from "./calibration/store";
import { type AppConfig, configFromEnv } from "./config";
import { adminRoutes } from "./routes/admin";
import { calibrationRoutes } from "./routes/calibration";
import { ingestRoutes } from "./routes/ingest";
import { meRoutes } from "./routes/me";
import { opsRoutes } from "./routes/ops";
import { memberRoutes } from "./routes/members";
import { stationRoutes } from "./routes/stations";
import { templateRoutes } from "./routes/templates";
import type { Database } from "./db/db";

// REST API skeleton (specs/02): structured logs with request ids; business
// routes arrive with T3.2–T3.4. Logs never contain landmarks or video (specs/07).

export interface AppDeps {
  db: Kysely<Database>;
  config?: AppConfig;
  /** Encrypted calibration recordings (specs/07); a local directory by default. */
  blobStore?: BlobStore;
  /** false, true, or pino options (e.g. a test stream). */
  logger?: boolean | { level?: string; stream?: NodeJS.WritableStream };
}

/** No bodies, no credentials in logs (specs/02, 07): request logs carry method, url and id only. */
function loggerOptions(logger: AppDeps["logger"]): FastifyServerOptions["logger"] {
  if (!logger) return false;
  return {
    ...(typeof logger === "object" ? logger : {}),
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"], censor: "[redacted]" },
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({ method: req.method, url: req.url.split("?")[0], id: req.id }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  } as FastifyServerOptions["logger"];
}

export function buildApp({ db, config = configFromEnv(), blobStore = new FileBlobStore("data/calibration"), logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: loggerOptions(logger), requestIdHeader: "x-request-id", genReqId: () => crypto.randomUUID() });
  app.addHook("onSend", async (req, reply) => void reply.header("x-request-id", req.id));
  const tokens = new AccessTokens(config.jwtSecret, config.now);
  const keys = new TenantKeys(config.qrMasterSecret);

  void app.register(rateLimit, { global: false });
  void app.register(authRoutes({ db, config, tokens, keys }));
  void app.register(memberRoutes(db, config, tokens));
  void app.register(templateRoutes(db, tokens));
  void app.register(meRoutes(db, config, tokens));
  void app.register(stationRoutes(db, tokens));
  void app.register(ingestRoutes(db, tokens));
  void app.register(calibrationRoutes(db, config, tokens, blobStore));
  void app.register(adminRoutes(db, config, tokens));
  void app.register(opsRoutes(db, config, tokens));

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
