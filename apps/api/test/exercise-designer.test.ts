import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { type Database, createDb } from "../src/db/db";
import { seedExercises } from "../src/ops/bootstrap";
import { B, type TestApi, rulePackJson, seedTenants, testApi } from "./helpers";

// Exercise designer: the gym's own rule packs, drafts and publishing (specs/11, T7.1).

let db: Kysely<Database>;
let api: TestApi;
let manager: string;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());
beforeEach(async () => {
  await seedTenants(db);
  api = testApi(db);
  manager = await api.staffToken("yonetici@a.test");
});

/** A valid pack: the squat, renamed. */
const sumo = (over: Record<string, unknown> = {}) => ({
  ...JSON.parse(rulePackJson("squat")),
  id: "t_sumo",
  name: { tr: "Sumo squat", en: "Sumo squat" },
  ...over,
});
const save = (token: string, id: string, definition: unknown) => api.call("PUT", `/admin/exercises/${id}/draft`, token, { definition });
const publish = (token: string, id: string) => api.call("POST", `/admin/exercises/${id}/publish`, token);
const template = (token: string, exerciseId: string) =>
  api.call("POST", "/program-templates", token, { name: "Bacak", blocks: [{ dayIndex: 0, position: 0, exerciseId, sets: 3, reps: 10, restSec: 60, mode: "strict" }] });

describe("AC-11.1: draft, validate, publish", () => {
  test("a draft is saved with its issues, and only a published pack can be used in a program", async () => {
    const broken = sumo({ rep: { ...sumo().rep, metric: "nope" } });
    const r = await save(manager, "t_sumo", broken);
    expect(r.status).toBe(200);
    expect(r.json().issues.length).toBeGreaterThan(0);
    const got = (await api.call("GET", "/admin/exercises/t_sumo/draft", manager)).json();
    expect(got.definition).toEqual(broken);
    expect(got.issues).toEqual(r.json().issues);
    expect(typeof got.updatedAt).toBe("string");

    const bad = await publish(manager, "t_sumo");
    expect(bad.status).toBe(400);
    expect(bad.json()).toMatchObject({ error: "invalid_rule_pack" });
    expect(bad.json().issues.length).toBeGreaterThan(0);

    expect((await save(manager, "t_sumo", sumo())).json().issues).toEqual([]);
    expect((await template(manager, "t_sumo")).status).toBe(400); // a draft is not usable yet
    const ok = await publish(manager, "t_sumo");
    expect(ok.status).toBe(200);
    expect(ok.json()).toEqual({ version: 1 });

    const served = (await api.call("GET", "/exercises", manager)).json().find((p: { id: string }) => p.id === "t_sumo");
    expect(served).toMatchObject({ id: "t_sumo", version: 1, status: "draft", definition: { id: "t_sumo", version: 1 } });
    expect((await template(manager, "t_sumo")).status).toBe(201);
    // publishing removes the draft
    expect((await api.call("GET", "/admin/exercises/t_sumo/draft", manager)).status).toBe(404);
  });

  test("the list shows drafts and published versions", async () => {
    await save(manager, "t_sumo", sumo());
    await publish(manager, "t_sumo");
    await save(manager, "t_sumo", sumo({ name: { tr: "Sumo squat 2", en: "Sumo squat 2" } }));
    await save(manager, "t_lunge", sumo({ id: "t_lunge", name: { tr: "Hamle", en: "Lunge" } }));
    const list = (await api.call("GET", "/admin/exercises", manager)).json();
    expect(list).toEqual([
      { id: "t_lunge", name: { tr: "Hamle", en: "Lunge" }, publishedVersion: null, draft: true, draftUpdatedAt: expect.any(String) },
      { id: "t_sumo", name: { tr: "Sumo squat 2", en: "Sumo squat 2" }, publishedVersion: 1, draft: true, draftUpdatedAt: expect.any(String) },
    ]);
  });

  test("a draft can be thrown away", async () => {
    await save(manager, "t_sumo", sumo());
    expect((await api.call("DELETE", "/admin/exercises/t_sumo/draft", manager)).status).toBe(204);
    expect((await api.call("GET", "/admin/exercises/t_sumo/draft", manager)).status).toBe(404);
    expect((await api.call("DELETE", "/admin/exercises/t_sumo/draft", manager)).status).toBe(404);
    expect((await publish(manager, "t_sumo")).status).toBe(404);
  });
});

describe("AC-11.2: versions", () => {
  test("publishing again adds version 2 and leaves version 1 as it was", async () => {
    await save(manager, "t_sumo", sumo());
    await publish(manager, "t_sumo");
    await save(manager, "t_sumo", sumo({ version: 7, rep: { ...sumo().rep, maxDurationMs: 9000 } }));
    expect((await publish(manager, "t_sumo")).json()).toEqual({ version: 2 });
    const rows = (await sql<{ version: number; definition_json: { version: number; rep: { maxDurationMs: number } } }>`
      select version, definition_json from exercises where id = 't_sumo' order by version`.execute(db)).rows;
    expect(rows.map((r) => [r.version, r.definition_json.version, r.definition_json.rep.maxDurationMs])).toEqual([
      [1, 1, sumo().rep.maxDurationMs],
      [2, 2, 9000],
    ]);
  });
});

describe("AC-11.3: roles and tenants", () => {
  test("trainers see the list but cannot design or publish", async () => {
    await save(manager, "t_sumo", sumo());
    const trainer = await api.staffToken("pt@a.test");
    expect((await api.call("GET", "/admin/exercises", trainer)).status).toBe(200);
    expect((await api.call("GET", "/admin/exercises/t_sumo/draft", trainer)).status).toBe(403);
    expect((await save(trainer, "t_sumo", sumo())).status).toBe(403);
    expect((await publish(trainer, "t_sumo")).status).toBe(403);
    expect((await api.call("DELETE", "/admin/exercises/t_sumo/draft", trainer)).status).toBe(403);
    const owner = await api.staffToken("sahip@a.test");
    expect((await publish(owner, "t_sumo")).status).toBe(200);
  });

  test("another gym's drafts and packs are invisible, and both gyms may use the same id", async () => {
    await save(manager, "t_sumo", sumo());
    await publish(manager, "t_sumo");
    await save(manager, "t_sumo", sumo());
    const managerB = await api.staffToken("yonetici@b.test", B);
    expect((await api.call("GET", "/admin/exercises", managerB)).json()).toEqual([]);
    expect((await api.call("GET", "/admin/exercises/t_sumo/draft", managerB)).status).toBe(404);
    expect((await publish(managerB, "t_sumo")).status).toBe(404);
    expect((await api.call("GET", "/exercises", managerB)).json().map((p: { id: string }) => p.id)).not.toContain("t_sumo");
    // B's own t_sumo starts at version 1
    await save(managerB, "t_sumo", sumo());
    expect((await publish(managerB, "t_sumo")).json()).toEqual({ version: 1 });
    expect((await template(managerB, "t_sumo")).status).toBe(201);
  });

  test("members and station tablets cannot reach the designer", async () => {
    await api.call("POST", "/members", manager, { displayName: "Ayşe", email: "ayse@a.test" });
    const member = await api.memberToken("ayse@a.test");
    expect((await api.call("GET", "/admin/exercises", member)).status).toBe(403);
    expect((await save(member, "t_sumo", sumo())).status).toBe(403);
    expect((await api.call("GET", "/admin/exercises")).status).toBe(401);
  });
});

describe("AC-11.4: ids", () => {
  test("gym exercise ids start with t_ and match the definition", async () => {
    for (const id of ["sumo", "squat", "t_", "t_A", "t-sumo", `t_${"x".repeat(41)}`]) {
      const r = await save(manager, id, sumo({ id }));
      expect(r.status, id).toBe(400);
      expect(r.json().error, id).toBe("invalid_exercise_id");
    }
    const mismatch = await save(manager, "t_sumo", sumo({ id: "t_other" }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.json().error).toBe("invalid_exercise_id");
  });

  test("the definition must be a JSON object of at most 64 KB", async () => {
    expect((await save(manager, "t_sumo", [1, 2])).status).toBe(400);
    expect((await save(manager, "t_sumo", sumo({ howTo: { tr: "x".repeat(70_000), en: "x" } }))).status).toBe(400);
  });

  test("the global seed rejects t_ ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gymspot-seed-"));
    writeFileSync(join(dir, "t_sumo.json"), JSON.stringify(sumo()));
    await expect(seedExercises(db, dir)).rejects.toThrow(/t_/);
  });
});
