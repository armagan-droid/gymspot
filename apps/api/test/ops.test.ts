import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { MemoryBlobStore } from "../src/calibration/store";
import { type Database, createDb } from "../src/db/db";
import { bootstrapTenant, runDailyJobs, seedExercises } from "../src/ops/bootstrap";
import { T0, testApi } from "./helpers";

let db: Kysely<Database>;
const exercisesDir = fileURLToPath(new URL("../../../exercises", import.meta.url));
/** Every pack in the repo, in file order (seeding sorts by file name). */
const packIds = readdirSync(exercisesDir).filter((f) => f.endsWith(".json")).sort().map((f) => f.slice(0, -5));

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());
beforeEach(async () => {
  await sql`truncate tenants, exercises cascade`.execute(db);
});

describe("seed-exercises (T5.4)", () => {
  test("loads every validated rule pack as a global exercise; idempotent", async () => {
    expect(packIds).toEqual(expect.arrayContaining(["pushup", "shoulder_press", "squat", "teep", "straight_punch"]));
    expect(await seedExercises(db, exercisesDir)).toEqual(packIds);
    expect(await seedExercises(db, exercisesDir)).toEqual(packIds);
    const rows = (await sql<{ id: string; version: number; tenant_id: string | null; status: string }>`select id, version, tenant_id, status from exercises order by id`.execute(db)).rows;
    expect(rows).toEqual([...packIds].sort().map((id) => ({ id, version: 1, tenant_id: null, status: "draft" })));
  });
});

describe("bootstrap-tenant (T5.4)", () => {
  test("creates the gym, its settings and an owner who can sign in", async () => {
    const { tenantId } = await bootstrapTenant(db, { name: "Pilot Salon", ownerEmail: "Sahip@Pilot.test", ownerPassword: "cok-guclu-bir-parola" });
    const api = testApi(db);
    const login = await api.call("POST", "/auth/staff/login", undefined, { tenantId, email: "sahip@pilot.test", password: "cok-guclu-bir-parola" });
    expect(login.status).toBe(200);
    const settings = (await api.call("GET", "/settings", login.json().accessToken)).json();
    expect(settings).toEqual({ defaultMode: "strict", retentionMonths: 24, safetyPause: true });
  });

  test("rejects weak passwords and empty names", async () => {
    await expect(bootstrapTenant(db, { name: "X", ownerEmail: "a@b.test", ownerPassword: "kisa" })).rejects.toThrow(/12/);
    await expect(bootstrapTenant(db, { name: " ", ownerEmail: "a@b.test", ownerPassword: "cok-guclu-bir-parola" })).rejects.toThrow(/name/);
  });
});

describe("daily jobs", () => {
  test("purge expired sessions and calibration recordings", async () => {
    const r = await runDailyJobs(db, new MemoryBlobStore(), T0);
    expect(r).toEqual({ sessions: 0, recordings: 0 });
  });
});
