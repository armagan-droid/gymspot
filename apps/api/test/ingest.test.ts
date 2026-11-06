import { PROGRAM_TIMING, type PersistRecord, type ProgramCommand, createProgram, step } from "@gymspot/engine";
import { QR_TTL_MS, type ProgramInput, createQr, generateKeyPair } from "@gymspot/shared";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { type Database, createDb } from "../src/db/db";
import { A, T0, type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let manager: string;
let memberId: string;
let memberProgramId: string;
let memberToken: string;
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
  memberId = (await api.call("POST", "/members", manager, { displayName: "Ayşe", email: "ayse@a.test" })).json().id;
  const t = (
    await api.call("POST", "/program-templates", manager, {
      name: "A",
      blocks: [{ dayIndex: 0, position: 0, exerciseId: "squat", sets: 1, reps: 3, restSec: 60, mode: "strict" }],
    })
  ).json();
  memberProgramId = (await api.call("POST", `/members/${memberId}/programs`, manager, { templateId: t.id, startDate: "2026-11-06" })).json().id;
  memberToken = await api.memberToken("ayse@a.test");
});

/** Records exactly as the phone's program engine emits them for a 1×3 squat session. */
function sessionRecords(o: { sessionId?: string; outcomes?: ("valid" | "faulty" | "incomplete")[]; member?: string } = {}) {
  const sessionId = o.sessionId ?? uuid();
  let s = createProgram(
    {
      role: "owner",
      workout: { id: "w", name: "A", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 3, restSec: 60, mode: "strict" }] },
      sessionId,
      memberId: o.member ?? memberId,
      memberProgramId,
      workoutDayIndex: 0,
      deviceId: "phone-1",
    },
    T0,
  );
  const out: PersistRecord[] = [];
  const send = (i: ProgramInput) => {
    const r = step(s, i, { newId: uuid });
    s = r.state;
    r.commands.forEach((c: ProgramCommand) => c.type === "PERSIST_EVENT" && out.push(c.record));
  };
  send({ type: "USER_ACTION", kind: "START" });
  send({ type: "USER_ACTION", kind: "START" });
  send({ type: "TICK", now: T0 + PROGRAM_TIMING.countdownMs });
  for (const outcome of o.outcomes ?? ["valid", "faulty", "valid", "valid"]) {
    send({ type: "REP_COMPLETED", outcome, faults: outcome === "faulty" ? ["insufficient_depth"] : [], durationMs: 1800 });
  }
  return { sessionId, records: out };
}

const ingest = (records: unknown[], token = memberToken) => api.call("POST", "/ingest", token, { records });
const statuses = (r: { json: () => { results: { status: string }[] } }) => r.json().results.map((x) => x.status);

describe("POST /ingest (specs/06)", () => {
  test("a full engine session lands in the database", async () => {
    const { sessionId, records } = sessionRecords();
    expect(records.map((r) => r.kind)).toEqual(["session", "rep", "rep", "rep", "rep", "set", "session_block", "session"]);
    const r = await ingest(records);
    expect(r.status).toBe(200);
    expect(new Set(statuses(r))).toEqual(new Set(["ok"]));
    const session = (await sql<{ status: string }>`select status from sessions where id = ${sessionId}`.execute(db)).rows[0];
    expect(session?.status).toBe("done");
    const set = (await sql<{ valid_reps: number; faulty_reps: number }>`select valid_reps, faulty_reps from sets`.execute(db)).rows[0];
    expect(set).toEqual({ valid_reps: 3, faulty_reps: 1 });
    const summary = (await sql<{ fault_id: string; count: number }>`select fault_id, count from fault_summaries`.execute(db)).rows;
    expect(summary).toEqual([{ fault_id: "insufficient_depth", count: 1 }]);
  });

  test("AC-6.2: sending the same records again duplicates nothing and changes no counters", async () => {
    const { records } = sessionRecords();
    await ingest(records);
    const again = await ingest(records);
    expect(new Set(statuses(again))).toEqual(new Set(["duplicate"]));
    const counts = await sql<{ reps: number; sets: number }>`select (select count(*)::int from rep_events) as reps, (select count(*)::int from sets) as sets`.execute(db);
    expect(counts.rows[0]).toEqual({ reps: 4, sets: 1 });
    expect((await sql<{ valid_reps: number }>`select valid_reps from sets`.execute(db)).rows[0]!.valid_reps).toBe(3);
  });

  test("children sent before their parents are 'retry' until the parents arrive", async () => {
    const { records } = sessionRecords();
    const [session, ...rest] = records;
    const reps = rest.filter((r) => r.kind === "rep");
    expect(statuses(await ingest([session, ...reps]))).toEqual(["ok", "retry", "retry", "retry", "retry"]);
    const parents = rest.filter((r) => r.kind !== "rep");
    expect(new Set(statuses(await ingest(parents)))).toEqual(new Set(["ok"]));
    expect(new Set(statuses(await ingest(reps)))).toEqual(new Set(["ok"]));
  });

  test("session status only moves forward", async () => {
    const { records } = sessionRecords();
    const [start] = records;
    const end = records.at(-1)!;
    await ingest([end]);
    expect(statuses(await ingest([start]))).toEqual(["duplicate"]);
    const s = (await sql<{ status: string; ended_at: Date | null }>`select status, ended_at from sessions`.execute(db)).rows[0]!;
    expect(s.status).toBe("done");
    expect(s.ended_at).not.toBeNull();
  });

  test("a member cannot write another member's session or add to it", async () => {
    const other = (await api.call("POST", "/members", manager, { displayName: "Burak", email: "burak@a.test" })).json().id;
    const foreign = sessionRecords({ member: other });
    expect(statuses(await ingest([foreign.records[0]]))).toEqual(["rejected"]);
    // Burak's own session, then Ayşe tries to append a block to it
    const burakToken = await api.memberToken("burak@a.test");
    await ingest([foreign.records[0]], burakToken);
    const block = foreign.records.find((r) => r.kind === "session_block")!;
    expect(statuses(await ingest([block]))).toEqual(["rejected"]);
  });

  test("invalid records are rejected without blocking the rest", async () => {
    const { records } = sessionRecords();
    const bad = { kind: "rep", data: { ...records[1]!.data, landmarks: [[0.1, 0.2]] } };
    const r = await ingest([records[0], bad, { kind: "video", data: {} }]);
    expect(statuses(r)).toEqual(["ok", "rejected", "rejected"]);
  });

  test("set counters are recomputed from rep events", async () => {
    const { records } = sessionRecords();
    const set = records.find((r) => r.kind === "set")!;
    const tampered = { ...set, data: { ...set.data, validReps: 99 } };
    await ingest(records.map((r) => (r === set ? tampered : r)));
    expect((await sql<{ valid_reps: number }>`select valid_reps from sets`.execute(db)).rows[0]!.valid_reps).toBe(3);
  });

  test("the batch size is limited", async () => {
    expect((await ingest(Array.from({ length: 501 }, () => ({})))).status).toBe(400);
  });
});

describe("tablet writes for a handed-off session (specs/03 'Kayıtlar')", () => {
  async function tablet() {
    const station = (await api.call("POST", "/stations", manager, { name: "Şınav Alanı" })).json().id;
    const { code } = (await api.call("POST", `/stations/${station}/pairing-code`, manager)).json();
    const { deviceToken } = (await api.call("POST", "/auth/device/pair", undefined, { code })).json();
    return (await api.call("POST", "/auth/device/session", undefined, { deviceToken })).json().accessToken as string;
  }

  async function handOff(device: string, sessionId: string) {
    const phone = await generateKeyPair();
    const delegation = (await api.call("POST", "/auth/member/qr-delegation", memberToken, { publicKey: phone.publicKeyB64 })).json();
    const qr = await createQr({ v: 1, tid: A, mid: memberId, sid: sessionId, bi: 0, si: 0, jti: uuid(), exp: T0 + QR_TTL_MS }, phone.secretKey, delegation);
    expect((await api.call("POST", "/auth/qr/redeem", device, { qr })).status).toBe(200);
  }

  test("without a handoff the tablet cannot write; after it, blocks/sets/reps land", async () => {
    const device = await tablet();
    const { sessionId, records } = sessionRecords();
    await ingest([records[0]]); // phone writes the session
    const tabletRecords = records.filter((r) => r.kind !== "session");
    expect(new Set(statuses(await ingest(tabletRecords, device)))).toEqual(new Set(["rejected"]));
    await handOff(device, sessionId);
    expect(new Set(statuses(await ingest(tabletRecords, device)))).toEqual(new Set(["ok"]));
  });

  test("tablets never write session records", async () => {
    const device = await tablet();
    const { sessionId, records } = sessionRecords();
    await handOff(device, sessionId);
    expect(statuses(await ingest([records[0]], device))).toEqual(["rejected"]);
  });

  test("two blocks for the same position: first wins, the second and its children are rejected and logged", async () => {
    const first = sessionRecords();
    await ingest(first.records);
    const dupe = sessionRecords({ sessionId: first.sessionId }); // same session, new block/set/rep ids
    const r = await ingest(dupe.records.filter((x) => x.kind !== "session"));
    expect(new Set(statuses(r))).toEqual(new Set(["rejected"]));
    const logged = await sql<{ n: number }>`select count(*)::int as n from ingest_conflicts`.execute(db);
    expect(logged.rows[0]!.n).toBeGreaterThan(0);
    const audit = await sql<{ n: number }>`select count(*)::int as n from audit_log where action = 'ingest_conflict'`.execute(db);
    expect(audit.rows[0]!.n).toBeGreaterThan(0);
  });
});
