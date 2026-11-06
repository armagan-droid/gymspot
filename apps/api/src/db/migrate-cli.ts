import { createDb, migrateDownAll, migrateToLatest } from "./db";

// `pnpm --filter @gymspot/api migrate [up|down]` against DATABASE_URL.
const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/gymspot";
const db = createDb(url);
const direction = process.argv[2] ?? "up";
try {
  await (direction === "down" ? migrateDownAll(db) : migrateToLatest(db));
  console.log(`migrations ${direction}: ok`);
} finally {
  await db.destroy();
}
