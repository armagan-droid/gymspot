import { buildApp } from "./app";
import { configFromEnv } from "./config";
import { createDb } from "./db/db";

const db = createDb(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/gymspot");
const app = buildApp({ db, config: configFromEnv(), logger: true });
const port = Number(process.env.PORT ?? 3000);

await app.listen({ port, host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close().then(() => db.destroy()));
}
