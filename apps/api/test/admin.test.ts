import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { type Database, createDb } from "../src/db/db";
import { A, B, T0, type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let ids: Awaited<ReturnType<typeof seedTenants>>;
let owner: string;
let manager: string;
let trainer: string;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());

beforeEach(async () => {
  ids = await seedTenants(db);
  api = testApi(db);
  [owner, manager, trainer] = await Promise.all([api.staffToken("sahip@a.test"), api.staffToken("yonetici@a.test"), api.staffToken("pt@a.test")]);
});

async function member(name = "Ayşe", email = "ayse@a.test") {
  return (await api.call("POST", "/members", manager, { displayName: name, email })).json().id as string;
}

async function session(memberId: string, status: string, startedAt: string, faults: string[][] = []) {
  const sid = crypto.randomUUID();
  const bid = crypto.randomUUID();
  const setId = crypto.randomUUID();
  await sql`insert into sessions (id, tenant_id, member_id, workout_day_index, started_at, status) values (${sid}, ${A}, ${memberId}, 0, ${startedAt}, ${status})`.execute(db);
  if (faults.length > 0) {
    await sql`insert into session_blocks (id, tenant_id, session_id, position, exercise_id, exercise_version, planned_sets, executed_by_device_id, status)
              values (${bid}, ${A}, ${sid}, 0, 'squat', 1, 1, 'phone', 'done')`.execute(db);
    await sql`insert into sets (id, tenant_id, session_block_id, set_index, valid_reps, faulty_reps, incomplete_reps, source, below_target, started_at, ended_at)
              values (${setId}, ${A}, ${bid}, 0, 0, 0, 0, 'camera', false, ${startedAt}, ${startedAt})`.execute(db);
    for (const [i, f] of faults.entries()) {
      await sql`insert into rep_events (id, tenant_id, set_id, rep_index, outcome, duration_ms, faults) values (${crypto.randomUUID()}, ${A}, ${setId}, ${i}, 'valid', 1500, ${f})`.execute(db);
    }
  }
  return sid;
}

describe("C2 overview", () => {
  test("active and today's sessions, station health", async () => {
    const m = await member();
    await session(m, "active", "2026-11-06T09:30:00Z");
    await session(m, "done", "2026-11-06T08:00:00Z");
    await session(m, "done", "2026-11-05T08:00:00Z");
    await api.call("POST", "/stations", manager, { name: "Squat Rafı 2" });
    const r = (await api.call("GET", "/admin/overview", manager)).json();
    expect(r).toMatchObject({ activeSessions: 1, sessionsToday: 2, stations: [{ name: "Squat Rafı 2", devices: 0, lastSeenAt: null, online: false }] });
    expect((await api.call("GET", "/admin/overview", trainer)).status).toBe(403);
  });
});

describe("C3 stations with devices", () => {
  test("paired devices are listed and can be removed", async () => {
    const st = (await api.call("POST", "/stations", manager, { name: "Şınav Alanı" })).json().id;
    const { code } = (await api.call("POST", `/stations/${st}/pairing-code`, manager)).json();
    const paired = (await api.call("POST", "/auth/device/pair", undefined, { code })).json();
    const list = (await api.call("GET", "/stations", manager)).json();
    expect(list[0].devices).toEqual([{ id: paired.deviceId, kind: "tablet", lastSeenAt: expect.any(String) }]);
  });
});

describe("C6 member insights", () => {
  test("top faults of the last 30 days and weekly sessions", async () => {
    const m = await member();
    await api.call("PUT", `/members/${m}/trainers/${ids.trainerA}`, manager);
    await session(m, "done", "2026-11-04T08:00:00Z", [["knee_valgus"], ["knee_valgus", "insufficient_depth"], []]);
    await session(m, "done", "2026-10-28T08:00:00Z", [["insufficient_depth"]]);
    await session(m, "done", "2026-09-01T08:00:00Z", [["excessive_forward_lean"]]); // older than 30 days
    const r = (await api.call("GET", `/members/${m}/insights`, trainer)).json();
    expect(r.topFaults).toEqual([
      { exerciseId: "squat", faultId: "insufficient_depth", count: 2 },
      { exerciseId: "squat", faultId: "knee_valgus", count: 2 },
    ]);
    expect(r.weeklySessions).toEqual([
      { week: "2026-10-26", sessions: 1 },
      { week: "2026-11-02", sessions: 1 },
    ]);
  });

  test("unassigned trainers and other tenants get 404", async () => {
    const m = await member();
    expect((await api.call("GET", `/members/${m}/insights`, trainer)).status).toBe(404);
    const managerB = await api.staffToken("yonetici@b.test", B);
    expect((await api.call("GET", `/members/${m}/insights`, managerB)).status).toBe(404);
  });
});

describe("C8 settings and users (owner)", () => {
  test("defaults, update, and owner-only writes", async () => {
    expect((await api.call("GET", "/settings", trainer)).json()).toEqual({ defaultMode: "strict", retentionMonths: 24, safetyPause: true });
    expect((await api.call("PUT", "/settings", manager, { defaultMode: "lenient", retentionMonths: 12, safetyPause: false })).status).toBe(403);
    expect((await api.call("PUT", "/settings", owner, { defaultMode: "lenient", retentionMonths: 12, safetyPause: false })).status).toBe(200);
    expect((await api.call("GET", "/settings", manager)).json()).toEqual({ defaultMode: "lenient", retentionMonths: 12, safetyPause: false });
    expect((await api.call("PUT", "/settings", owner, { defaultMode: "strict", retentionMonths: 0, safetyPause: true })).status).toBe(400);
  });

  test("the safety pause setting reaches phones and tablets (specs/05)", async () => {
    await api.call("PUT", "/settings", owner, { defaultMode: "strict", retentionMonths: 24, safetyPause: false });
    const m = await member();
    const t = (await api.call("POST", "/program-templates", manager, { name: "A", blocks: [{ dayIndex: 0, position: 0, exerciseId: "squat", sets: 1, reps: 5, restSec: 30, mode: "strict" }] })).json();
    await api.call("POST", `/members/${m}/programs`, manager, { templateId: t.id, startDate: "2026-11-01" });
    const memberToken = await api.memberToken("ayse@a.test");
    expect((await api.call("GET", "/me/program", memberToken)).json()).toMatchObject({ safetyPause: false });

    const st = (await api.call("POST", "/stations", manager, { name: "S" })).json().id;
    const { code } = (await api.call("POST", `/stations/${st}/pairing-code`, manager)).json();
    const { deviceToken } = (await api.call("POST", "/auth/device/pair", undefined, { code })).json();
    const device = (await api.call("POST", "/auth/device/session", undefined, { deviceToken })).json().accessToken;
    expect((await api.call("GET", "/auth/qr-public-key", device)).json()).toMatchObject({ safetyPause: false });
  });

  test("owners list and add staff; the new user can sign in", async () => {
    const created = await api.call("POST", "/users", owner, { email: "pt3@a.test", role: "trainer", password: "yeni-parola-1234" });
    expect(created.status).toBe(201);
    expect((await api.call("POST", "/users", owner, { email: "pt3@a.test", role: "trainer", password: "yeni-parola-1234" })).status).toBe(409);
    expect((await api.call("POST", "/users", manager, { email: "x@a.test", role: "trainer", password: "yeni-parola-1234" })).status).toBe(403);
    expect((await api.call("POST", "/users", owner, { email: "y@a.test", role: "owner", password: "kısa" })).status).toBe(400);
    const list = (await api.call("GET", "/users", owner)).json();
    expect(list.map((u: { email: string }) => u.email)).toContain("pt3@a.test");
    expect(JSON.stringify(list)).not.toContain("password");
    const login = await api.call("POST", "/auth/staff/login", undefined, { tenantId: A, email: "pt3@a.test", password: "yeni-parola-1234" });
    expect(login.status).toBe(200);
  });

  test("managers list trainers for assignment; trainers cannot", async () => {
    const r = (await api.call("GET", "/trainers", manager)).json();
    expect(r.map((u: { email: string }) => u.email)).toEqual(["pt2@a.test", "pt@a.test"]);
    expect(JSON.stringify(r)).not.toContain("hash");
    expect((await api.call("GET", "/trainers", trainer)).status).toBe(403);
  });

  test("managers see open member data requests", async () => {
    await member();
    const memberToken = await api.memberToken("ayse@a.test");
    await api.call("POST", "/me/data-requests", memberToken, { kind: "delete" });
    const r = (await api.call("GET", "/data-requests", manager)).json();
    expect(r).toEqual([expect.objectContaining({ kind: "delete", memberName: "Ayşe", requestedAt: new Date(T0).toISOString(), completedAt: null })]);
    expect((await api.call("GET", "/data-requests", trainer)).status).toBe(403);
  });
});
