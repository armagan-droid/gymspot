import { PROGRAM_TIMING, type PersistRecord, createProgram, step } from "@gymspot/engine";
import type { ProgramInput } from "@gymspot/shared";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { purgeExpiredSessions } from "../src/privacy/erase";
import { type Database, createDb } from "../src/db/db";
import { B, T0, type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let ids: Awaited<ReturnType<typeof seedTenants>>;
let manager: string;
let managerB: string;
let trainer: string;
let ayse: { id: string; token: string; programId: string; templateId: string };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());

beforeEach(async () => {
  ids = await seedTenants(db);
  api = testApi(db);
  [manager, managerB, trainer] = await Promise.all([api.staffToken("yonetici@a.test"), api.staffToken("yonetici@b.test", B), api.staffToken("pt@a.test")]);
  const m = (await api.call("POST", "/members", manager, { displayName: "Ayşe Yıldırım", email: "ayse.yildirim@a.test", phone: "+905551112233", externalRef: "UYE-778" })).json();
  await api.call("PUT", `/members/${m.id}/trainers/${ids.trainerA}`, manager);
  const t = (
    await api.call("POST", "/program-templates", manager, { name: "A", blocks: [{ dayIndex: 0, position: 0, exerciseId: "squat", sets: 1, reps: 1, restSec: 30, mode: "strict" }] })
  ).json();
  const programId = (await api.call("POST", `/members/${m.id}/programs`, manager, { templateId: t.id, startDate: "2026-01-01" })).json().id;
  const token = await api.memberToken("ayse.yildirim@a.test");
  await api.call("POST", "/me/consent", token, { version: "v1" });
  ayse = { id: m.id, token, programId, templateId: t.id };
});

async function uploadSession(at: number) {
  let s = createProgram(
    {
      role: "owner",
      workout: { id: "w", name: "A", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 1, restSec: 30, mode: "strict" }] },
      sessionId: uuid(),
      memberId: ayse.id,
      memberProgramId: ayse.programId,
      workoutDayIndex: 0,
      deviceId: "phone",
    },
    at,
  );
  const records: PersistRecord[] = [];
  const send = (i: ProgramInput) => {
    const r = step(s, i, { newId: uuid });
    s = r.state;
    r.commands.forEach((c) => c.type === "PERSIST_EVENT" && records.push(c.record));
  };
  send({ type: "USER_ACTION", kind: "START" });
  send({ type: "USER_ACTION", kind: "START" });
  send({ type: "TICK", now: at + PROGRAM_TIMING.countdownMs });
  send({ type: "REP_COMPLETED", outcome: "faulty", faults: ["knee_valgus"], durationMs: 1500 });
  send({ type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1500 });
  const r = await api.call("POST", "/ingest", ayse.token, { records });
  expect(new Set(r.json().results.map((x: { status: string }) => x.status))).toEqual(new Set(["ok"]));
}

/** Every text-like column of every table, searched for a value. */
async function occurrences(needle: string): Promise<string[]> {
  const cols = (
    await sql<{ table_name: string; column_name: string }>`
      select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.data_type in ('text', 'character varying', 'jsonb', 'ARRAY')`.execute(db)
  ).rows;
  const hits: string[] = [];
  for (const c of cols) {
    const r = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(c.table_name)} where ${sql.ref(c.column_name)}::text ilike ${`%${needle}%`}`.execute(db);
    if (r.rows[0]!.n > 0) hits.push(`${c.table_name}.${c.column_name}`);
  }
  return hits;
}

describe("AC-7.2: member deletion leaves no personal data", () => {
  test("after the request is completed, no personal data remains anywhere", async () => {
    await uploadSession(T0 - 3600_000);
    await api.call("POST", "/me/data-requests", ayse.token, { kind: "delete" });
    const [request] = (await api.call("GET", "/data-requests", manager)).json();
    expect((await occurrences("Yıldırım")).length).toBeGreaterThan(0); // the sweep can find it before

    const done = await api.call("POST", `/data-requests/${request.id}/complete`, manager);
    expect(done.status).toBe(204);

    for (const pii of ["Yıldırım", "ayse.yildirim", "5551112233", "UYE-778"]) {
      expect(await occurrences(pii), pii).toEqual([]);
    }
    const counts = (
      await sql<{ sessions: number; sets: number; reps: number; programs: number; trainers: number; tokens: number }>`select
        (select count(*)::int from sessions) as sessions, (select count(*)::int from sets) as sets,
        (select count(*)::int from rep_events) as reps, (select count(*)::int from member_programs) as programs,
        (select count(*)::int from trainer_members) as trainers,
        (select count(*)::int from auth_refresh_tokens where subject_id = ${ayse.id}) as tokens`.execute(db)
    ).rows[0];
    expect(counts).toEqual({ sessions: 0, sets: 0, reps: 0, programs: 0, trainers: 0, tokens: 0 });
    const row = (await sql<{ display_name: string; status: string; consent_at: Date | null }>`select display_name, status, consent_at from members where id = ${ayse.id}`.execute(db)).rows[0];
    expect(row).toEqual({ display_name: "Silinmiş üye", status: "anonymized", consent_at: null });
    expect((await api.call("GET", "/data-requests", manager)).json()[0].completedAt).not.toBeNull();
  });

  test("the erased member can no longer sign in or use old tokens", async () => {
    const [request] = await (async () => {
      await api.call("POST", "/me/data-requests", ayse.token, { kind: "delete" });
      return (await api.call("GET", "/data-requests", manager)).json();
    })();
    await api.call("POST", `/data-requests/${request.id}/complete`, manager);
    const before = api.sent.length;
    await api.call("POST", "/auth/member/magic-link", undefined, { tenantId: request.tenantId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "ayse.yildirim@a.test" });
    expect(api.sent.length).toBe(before);
    expect((await api.call("GET", "/me", ayse.token)).status).toBe(404);
  });

  test("only managers/owners of the same tenant complete requests, once", async () => {
    await api.call("POST", "/me/data-requests", ayse.token, { kind: "delete" });
    const [request] = (await api.call("GET", "/data-requests", manager)).json();
    expect((await api.call("POST", `/data-requests/${request.id}/complete`, trainer)).status).toBe(403);
    expect((await api.call("POST", `/data-requests/${request.id}/complete`, managerB)).status).toBe(404);
    expect((await api.call("POST", `/data-requests/${request.id}/complete`, manager)).status).toBe(204);
    expect((await api.call("POST", `/data-requests/${request.id}/complete`, manager)).status).toBe(404);
  });
});

describe("retention (specs/07: 24 months by default, gym-adjustable)", () => {
  test("sessions older than the gym's retention are purged with their children", async () => {
    const DAY = 24 * 3600_000;
    await uploadSession(T0 - 800 * DAY); // ~26 months
    await uploadSession(T0 - 30 * DAY);
    expect(await purgeExpiredSessions(db, T0)).toBe(1);
    expect((await sql<{ n: number }>`select count(*)::int as n from sessions`.execute(db)).rows[0]!.n).toBe(1);
    expect((await sql<{ n: number }>`select count(*)::int as n from sets`.execute(db)).rows[0]!.n).toBe(1);

    const owner = await api.staffToken("sahip@a.test");
    await api.call("PUT", "/settings", owner, { defaultMode: "strict", retentionMonths: 1, safetyPause: true });
    expect(await purgeExpiredSessions(db, T0 + 10 * DAY)).toBe(1);
    expect((await sql<{ n: number }>`select count(*)::int as n from sessions`.execute(db)).rows[0]!.n).toBe(0);
  });
});

describe("AC-6.1 sweep: tenant B never reaches tenant A's records by id", () => {
  test("every id route answers 404 to another tenant", async () => {
    await uploadSession(T0 - 3600_000);
    const sessionId = (await sql<{ id: string }>`select id from sessions limit 1`.execute(db)).rows[0]!.id;
    const station = (await api.call("POST", "/stations", manager, { name: "S" })).json().id;
    const { code } = (await api.call("POST", `/stations/${station}/pairing-code`, manager)).json();
    const device = (await api.call("POST", "/auth/device/pair", undefined, { code })).json().deviceId;
    await api.call("POST", "/me/data-requests", ayse.token, { kind: "delete" });
    const request = (await api.call("GET", "/data-requests", manager)).json()[0].id;

    const routes: [method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown][] = [
      ["GET", `/members/${ayse.id}`],
      ["PATCH", `/members/${ayse.id}`, { displayName: "x" }],
      ["GET", `/members/${ayse.id}/programs`],
      ["POST", `/members/${ayse.id}/programs`, { templateId: ayse.templateId, startDate: "2026-11-06" }],
      ["GET", `/members/${ayse.id}/sessions`],
      ["GET", `/members/${ayse.id}/insights`],
      ["PUT", `/members/${ayse.id}/trainers/${ids.trainerA}`],
      ["DELETE", `/members/${ayse.id}/trainers/${ids.trainerA}`],
      ["GET", `/program-templates/${ayse.templateId}`],
      ["PUT", `/program-templates/${ayse.templateId}`, { name: "x", blocks: [{ dayIndex: 0, position: 0, exerciseId: "squat", sets: 1, reps: 1, restSec: 0, mode: "strict" }] }],
      ["DELETE", `/program-templates/${ayse.templateId}`],
      ["POST", `/stations/${station}/pairing-code`],
      ["DELETE", `/devices/${device}`],
      ["POST", `/data-requests/${request}/complete`],
    ];
    for (const [method, url, body] of routes) {
      expect((await api.call(method, url, managerB, body)).status, `${method} ${url}`).toBe(404);
    }
    // and nothing changed on A's side
    expect((await api.call("GET", `/members/${ayse.id}`, manager)).json().displayName).toBe("Ayşe Yıldırım");
    expect((await sql<{ n: number }>`select count(*)::int as n from sessions where id = ${sessionId}`.execute(db)).rows[0]!.n).toBe(1);
  });
});
