import { PROGRAM_TIMING, type PersistRecord, createProgram, step } from "@gymspot/engine";
import type { ProgramInput } from "@gymspot/shared";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { type Database, createDb } from "../src/db/db";
import { T0, type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let manager: string;
let ayse: { id: string; token: string; programId: string };
let burak: { id: string; token: string };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());

beforeEach(async () => {
  await seedTenants(db);
  api = testApi(db);
  manager = await api.staffToken("yonetici@a.test");
  const a = (await api.call("POST", "/members", manager, { displayName: "Ayşe", email: "ayse@a.test" })).json();
  const b = (await api.call("POST", "/members", manager, { displayName: "Burak", email: "burak@a.test" })).json();
  const t = (
    await api.call("POST", "/program-templates", manager, {
      name: "A",
      blocks: [{ dayIndex: 0, position: 0, exerciseId: "squat", sets: 1, reps: 2, restSec: 60, mode: "strict" }],
    })
  ).json();
  const programId = (await api.call("POST", `/members/${a.id}/programs`, manager, { templateId: t.id, startDate: "2026-11-01" })).json().id;
  ayse = { id: a.id, token: await api.memberToken("ayse@a.test"), programId };
  burak = { id: b.id, token: await api.memberToken("burak@a.test") };
});

/** A finished 1×2 squat session with one faulty rep, uploaded through /ingest. */
async function uploadSession(at = T0) {
  const sessionId = uuid();
  let s = createProgram(
    {
      role: "owner",
      workout: { id: "w", name: "A", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 2, restSec: 60, mode: "strict" }] },
      sessionId,
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
  send({ type: "REP_COMPLETED", outcome: "faulty", faults: ["knee_valgus"], durationMs: 1700 });
  send({ type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1700 });
  send({ type: "REP_COMPLETED", outcome: "valid", faults: ["knee_valgus"], durationMs: 1700 });
  expect((await api.call("POST", "/ingest", ayse.token, { records })).status).toBe(200);
  return sessionId;
}

describe("B4 session detail", () => {
  test("blocks with sets, counts and fault summaries", async () => {
    const id = await uploadSession();
    const r = await api.call("GET", `/me/sessions/${id}`, ayse.token);
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({
      id,
      status: "done",
      blocks: [
        {
          exerciseId: "squat",
          status: "done",
          sets: [{ setIndex: 0, validReps: 2, faultyReps: 1, incompleteReps: 0, plannedReps: 2, faults: [{ faultId: "knee_valgus", count: 2 }] }],
        },
      ],
    });
  });

  test("another member's session is 404", async () => {
    const id = await uploadSession();
    expect((await api.call("GET", `/me/sessions/${id}`, burak.token)).status).toBe(404);
  });
});

describe("B5 progress", () => {
  test("weekly reps and clean ratio per exercise", async () => {
    await uploadSession(T0);
    await uploadSession(T0 + 7 * 24 * 3600_000);
    api.clock.now = T0 + 8 * 24 * 3600_000;
    const token = await api.memberToken("ayse@a.test"); // the earlier access token expired with the clock jump
    const r = (await api.call("GET", "/me/progress", token)).json();
    expect(r).toEqual([
      expect.objectContaining({ exerciseId: "squat", valid: 2, faulty: 1, incomplete: 0 }),
      expect.objectContaining({ exerciseId: "squat", valid: 2, faulty: 1, incomplete: 0 }),
    ]);
    expect(r[0].week < r[1].week).toBe(true);
  });
});

describe("B6 data rights (specs/07)", () => {
  test("export contains the member's own data only", async () => {
    await uploadSession();
    const r = await api.call("GET", "/me/export", ayse.token);
    expect(r.status).toBe(200);
    const body = r.json();
    expect(body.profile).toMatchObject({ id: ayse.id, displayName: "Ayşe", email: "ayse@a.test" });
    expect(body.programs).toHaveLength(1);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].blocks[0].sets[0].reps).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("Burak");
    expect(JSON.stringify(body)).not.toContain("landmark");
  });

  test("a deletion request is recorded and audited", async () => {
    const r = await api.call("POST", "/me/data-requests", ayse.token, { kind: "delete" });
    expect(r.status).toBe(202);
    const row = (await sql<{ kind: string; member_id: string; completed_at: Date | null }>`select kind, member_id, completed_at from data_requests`.execute(db)).rows;
    expect(row).toEqual([{ kind: "delete", member_id: ayse.id, completed_at: null }]);
    const audit = (await sql<{ n: number }>`select count(*)::int as n from audit_log where action = 'data_request_delete'`.execute(db)).rows[0]!.n;
    expect(audit).toBe(1);
  });

  test("a second open deletion request is not duplicated", async () => {
    await api.call("POST", "/me/data-requests", ayse.token, { kind: "delete" });
    await api.call("POST", "/me/data-requests", ayse.token, { kind: "delete" });
    expect((await sql<{ n: number }>`select count(*)::int as n from data_requests`.execute(db)).rows[0]!.n).toBe(1);
  });
});
