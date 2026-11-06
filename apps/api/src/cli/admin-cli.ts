import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FileBlobStore } from "../calibration/store";
import { createDb, migrateToLatest } from "../db/db";
import { bootstrapTenant, runDailyJobs, seedExercises } from "../ops/bootstrap";

// Operator commands (docs/deploy.md):
//   migrate                                      apply database migrations
//   seed-exercises [--dir exercises]             load global rule packs
//   bootstrap-tenant --name N --owner-email E    (password from OWNER_PASSWORD)
//   daily-jobs                                   retention purges (cron, once a day)

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

// `pnpm --filter @gymspot/api ops` runs in apps/api; the image runs at the root
const defaultExercisesDir = () => ["exercises", "../../exercises"].find((d) => existsSync(d)) ?? "exercises";

async function main() {
  const command = process.argv.slice(2).find((a) => a !== "--"); // pnpm 12 forwards a literal `--`
  const db = createDb(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/gymspot");
  try {
    switch (command) {
      case "migrate":
        await migrateToLatest(db);
        console.log("migrations: ok");
        break;
      case "seed-exercises":
        console.log(`seeded: ${(await seedExercises(db, resolve(arg("dir") ?? process.env.EXERCISES_DIR ?? defaultExercisesDir()))).join(", ")}`);
        break;
      case "bootstrap-tenant": {
        const name = arg("name");
        const ownerEmail = arg("owner-email");
        const ownerPassword = process.env.OWNER_PASSWORD; // never on the command line (shell history)
        if (!name || !ownerEmail || !ownerPassword) throw new Error("--name, --owner-email and OWNER_PASSWORD are required");
        const { tenantId } = await bootstrapTenant(db, { name, ownerEmail, ownerPassword });
        console.log(`tenant: ${tenantId}\nstaff sign-in: ${process.env.APP_BASE_URL ?? "https://<domain>"}/admin/login?tenant=${tenantId}`);
        break;
      }
      case "daily-jobs":
        console.log(JSON.stringify(await runDailyJobs(db, new FileBlobStore(process.env.CALIBRATION_STORE_DIR ?? "data/calibration"), Date.now())));
        break;
      default:
        throw new Error("commands: migrate | seed-exercises | bootstrap-tenant | daily-jobs");
    }
  } finally {
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
