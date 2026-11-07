import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { type Database, createDb } from "../src/db/db";
import { B, type TestApi, rulePackJson, seedTenants, testApi } from "./helpers";

// GET /exercises — rule packs come from the API, so a new exercise needs no
// redeploy (specs/10 T6.3, invariant 3). Global packs plus the tenant's own.

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

const ids = (res: { json: () => { id: string }[] }) => res.json().map((p) => p.id).sort();

describe("GET /exercises", () => {
  test("staff, members and station tablets get the global rule packs", async () => {
    await api.call("POST", "/members", manager, { displayName: "Ayşe", email: "ayse@a.test" });
    const member = await api.memberToken("ayse@a.test");
    const station = (await api.call("POST", "/stations", manager, { name: "Şınav Alanı" })).json().id;
    const { code } = (await api.call("POST", `/stations/${station}/pairing-code`, manager)).json();
    const { deviceToken } = (await api.call("POST", "/auth/device/pair", undefined, { code })).json();
    const device = (await api.call("POST", "/auth/device/session", undefined, { deviceToken })).json().accessToken;

    for (const token of [manager, member, device]) {
      const res = await api.call("GET", "/exercises", token);
      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(["pushup", "squat"]);
    }
    const squat = (await api.call("GET", "/exercises", manager)).json().find((p: { id: string }) => p.id === "squat");
    expect(squat).toEqual({ id: "squat", version: 1, status: "draft", definition: JSON.parse(rulePackJson("squat")) });
  });

  test("a tenant's own pack is visible to that tenant only (RLS)", async () => {
    const teep = rulePackJson("teep");
    await sql`insert into exercises (id, version, definition_json, status, tenant_id) values ('teep', 1, ${teep}::jsonb, 'draft', ${B})`.execute(db);
    const managerB = await api.staffToken("yonetici@b.test", B);
    expect(ids(await api.call("GET", "/exercises", manager))).toEqual(["pushup", "squat"]);
    expect(ids(await api.call("GET", "/exercises", managerB))).toEqual(["pushup", "squat", "teep"]);
  });

  test("only the latest version of each exercise is served", async () => {
    const v2 = { ...JSON.parse(rulePackJson("squat")), version: 2, status: "calibrated" };
    await sql`insert into exercises (id, version, definition_json, status, tenant_id) values ('squat', 2, ${JSON.stringify(v2)}::jsonb, 'calibrated', null)`.execute(db);
    const squat = (await api.call("GET", "/exercises", manager)).json().filter((p: { id: string }) => p.id === "squat");
    expect(squat).toHaveLength(1);
    expect(squat[0]).toMatchObject({ version: 2, status: "calibrated", definition: { version: 2 } });
  });

  test("requires sign-in", async () => {
    expect((await api.call("GET", "/exercises")).status).toBe(401);
  });
});
