import {
  type ProgramInput,
  RepEventRecordSchema,
  SessionBlockRecordSchema,
  SessionRecordSchema,
  SetRecordSchema,
  type Workout,
} from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import {
  PROGRAM_TIMING,
  type ProgramCommand,
  type ProgramConfig,
  type ProgramState,
  type ProgramStatus,
  createProgram,
  deserializeProgram,
  serializeProgram,
  step,
} from "../src/index";

const T0 = Date.UTC(2026, 10, 6, 9, 0, 0);
const SESSION = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

const squat = (o: Partial<Workout["blocks"][number]> = {}) =>
  ({ exerciseId: "squat", exerciseVersion: 1, sets: 3, reps: 10, restSec: 60, mode: "strict", ...o }) as Workout["blocks"][number];
const pushup = (o: Partial<Workout["blocks"][number]> = {}) =>
  ({ exerciseId: "pushup", exerciseVersion: 1, sets: 3, reps: 8, restSec: 60, mode: "strict", ...o }) as Workout["blocks"][number];

function config(blocks: Workout["blocks"], o: Partial<ProgramConfig> = {}): ProgramConfig {
  return {
    role: "owner",
    workout: { id: "w1", name: "Gün A", blocks },
    sessionId: SESSION,
    memberId: "m1",
    memberProgramId: "mp1",
    workoutDayIndex: 0,
    deviceId: "phone-1",
    ...o,
  };
}

class Driver {
  state: ProgramState;
  log: ProgramCommand[] = [];
  private n = 0;

  constructor(cfg: ProgramConfig, now = T0, idStart = 0) {
    this.n = idStart;
    this.state = createProgram(cfg, now);
  }

  send(input: ProgramInput): ProgramCommand[] {
    const r = step(this.state, input, { newId: () => uuid(++this.n) });
    this.state = r.state;
    this.log.push(...r.commands);
    return r.commands;
  }
  act(kind: Extract<ProgramInput, { type: "USER_ACTION" }>["kind"]) {
    return this.send({ type: "USER_ACTION", kind });
  }
  tick(ms: number) {
    return this.send({ type: "TICK", now: this.state.now + ms });
  }
  rep(outcome: "valid" | "faulty" | "incomplete" = "valid", faults: string[] = []) {
    this.send({ type: "REP_STARTED" });
    return this.send({ type: "REP_COMPLETED", outcome, faults, durationMs: 1800 });
  }
  /** READY → countdown → SET_ACTIVE */
  beginSet() {
    this.send({ type: "READY_POSE_HELD" });
    this.tick(PROGRAM_TIMING.countdownMs);
  }
  get status(): ProgramStatus {
    return this.state.status;
  }
  records(kind?: string) {
    return this.log.flatMap((c) => (c.type === "PERSIST_EVENT" && (!kind || c.record.kind === kind) ? [c.record] : []));
  }
}

const started = (blocks: Workout["blocks"], o?: Partial<ProgramConfig>) => {
  const d = new Driver(config(blocks, o));
  d.act("START");
  return d;
};

describe("AC-3.2: 3×10 squat + 3×8 push-up runs to SESSION_DONE", () => {
  test("full session with expected commands and records", () => {
    const d = started([squat(), pushup()]);
    expect(d.status).toBe("READY");
    for (const [reps] of [[10], [8]] as const) {
      for (let set = 0; set < 3; set++) {
        d.beginSet();
        expect(d.status).toBe("SET_ACTIVE");
        for (let r = 0; r < reps; r++) d.rep();
        if (set < 2) {
          expect(d.status).toBe("REST");
          d.tick(60_000);
          expect(d.status).toBe("READY");
        }
      }
    }
    expect(d.status).toBe("SESSION_DONE");

    const kinds = d.records().map((r) => r.kind);
    expect(kinds.filter((k) => k === "session")).toHaveLength(2);
    expect(kinds.filter((k) => k === "rep")).toHaveLength(54);
    expect(kinds.filter((k) => k === "set")).toHaveLength(6);
    expect(kinds.filter((k) => k === "session_block")).toHaveLength(2);
    expect(kinds[0]).toBe("session");
    expect(kinds.at(-1)).toBe("session");

    const speaks = d.log.filter((c) => c.type === "SPEAK").map((c) => c.key);
    expect(speaks.filter((k) => k === "countdown.start")).toHaveLength(6);
    expect(speaks.filter((k) => k === "set.go")).toHaveLength(6);
    expect(speaks.filter((k) => k === "rest.over")).toHaveLength(4);
    expect(speaks.at(-1)).toBe("session.done");
  });

  test("records conform to the ingestion schemas (specs/06)", () => {
    const d = started([squat({ sets: 1, reps: 2 })]);
    d.beginSet();
    d.rep();
    d.rep("faulty", ["knee_valgus"]);
    d.rep();
    const schema = { session: SessionRecordSchema, session_block: SessionBlockRecordSchema, set: SetRecordSchema, rep: RepEventRecordSchema };
    for (const r of d.records()) {
      const res = schema[r.kind].safeParse(r.data);
      expect(res.success, `${r.kind}: ${JSON.stringify(res.error?.issues)}`).toBe(true);
    }
    const [start, end] = d.records("session").map((r) => r.data as { status: string; endedAt?: string });
    expect(start!.status).toBe("active");
    expect(end!.status).toBe("done");
    expect(end!.endedAt).toBeDefined();
  });
});

describe("AC-3.3: counting by mode", () => {
  test("strict: faulty and incomplete do not count", () => {
    const d = started([squat({ sets: 1, reps: 2 })]);
    d.beginSet();
    d.rep("faulty", ["insufficient_depth"]);
    d.rep("incomplete");
    expect(d.status).toBe("SET_ACTIVE");
    expect(d.state.set!.counted).toBe(0);
    d.rep();
    d.rep();
    expect(d.status).toBe("SESSION_DONE");
  });

  test("lenient: faulty counts and is recorded as faulty; incomplete never counts", () => {
    const d = started([squat({ sets: 1, reps: 2, mode: "lenient" })]);
    d.beginSet();
    d.rep("incomplete");
    d.rep("faulty", ["insufficient_depth"]);
    expect(d.state.set!.counted).toBe(1);
    d.rep();
    expect(d.status).toBe("SESSION_DONE");
    const reps = d.records("rep").map((r) => r.data as { outcome: string; faults: string[] });
    expect(reps.map((r) => r.outcome)).toEqual(["incomplete", "faulty", "valid"]);
    expect(reps[1]!.faults).toEqual(["insufficient_depth"]);
    const set = d.records("set")[0]!.data as { validReps: number; faultyReps: number; incompleteReps: number; belowTarget: boolean };
    expect(set).toMatchObject({ validReps: 1, faultyReps: 1, incompleteReps: 1, belowTarget: false });
  });
});

describe("AC-3.4: inactivity and tracking timers (fake clock)", () => {
  test("10 s idle asks, CONTINUE_SET resets, 20 s closes below target", () => {
    const d = started([squat({ sets: 2, reps: 10 })]);
    d.beginSet();
    d.rep();
    d.tick(9_900);
    expect(d.status).toBe("SET_ACTIVE");
    const ask = d.tick(200);
    expect(d.status).toBe("SET_CONFIRM");
    expect(ask).toContainEqual({ type: "SPEAK", key: "prompt.set_done" });
    d.act("CONTINUE_SET");
    expect(d.status).toBe("SET_ACTIVE");
    d.tick(10_000);
    expect(d.status).toBe("SET_CONFIRM");
    d.tick(10_000);
    expect(d.status).toBe("REST");
    const set = d.records("set")[0]!.data as { validReps: number; belowTarget: boolean };
    expect(set).toMatchObject({ validReps: 1, belowTarget: true });
  });

  test("a rep during SET_CONFIRM returns to SET_ACTIVE and counts", () => {
    const d = started([squat({ sets: 1, reps: 10 })]);
    d.beginSet();
    d.tick(10_000);
    expect(d.status).toBe("SET_CONFIRM");
    d.rep();
    expect(d.status).toBe("SET_ACTIVE");
    expect(d.state.set!.counted).toBe(1);
  });

  test("END_SET in SET_CONFIRM ends the set", () => {
    const d = started([squat({ sets: 2 })]);
    d.beginSet();
    d.tick(10_000);
    d.act("END_SET");
    expect(d.status).toBe("REST");
  });

  test("tracking lost for 5 s pauses; restored earlier does not", () => {
    const d = started([squat()]);
    d.beginSet();
    d.send({ type: "TRACKING_LOST" });
    d.tick(4_000);
    d.send({ type: "TRACKING_RESTORED" });
    d.tick(5_000);
    expect(d.status).toBe("SET_ACTIVE");
    d.rep(); // keep the inactivity timer (10 s) out of the way
    d.send({ type: "TRACKING_LOST" });
    d.tick(5_000);
    expect(d.status).toBe("PAUSED");
    expect(d.state.resumeTo).toBe("SET_ACTIVE");
    expect(d.send({ type: "TRACKING_RESTORED" })).toContainEqual({ type: "SHOW", key: "prompt.resume" });
    expect(d.status).toBe("PAUSED"); // no automatic resume
  });

  test("tracking loss during REST does not pause", () => {
    const d = started([squat({ restSec: 120 })]);
    d.beginSet();
    for (let i = 0; i < 10; i++) d.rep();
    d.send({ type: "TRACKING_LOST" });
    d.tick(10_000);
    expect(d.status).toBe("REST");
  });
});

describe("AC-3.5: serialize / deserialize", () => {
  test("a restored state continues identically", () => {
    const a = started([squat({ sets: 2, reps: 3 })]);
    a.beginSet();
    a.rep();
    a.rep();
    const json = serializeProgram(a.state);
    const b = new Driver(config([]));
    b.state = deserializeProgram(json);
    expect(b.state).toEqual(a.state);
    for (const d of [a, b]) d.rep();
    expect(b.status).toBe("REST");
    expect(b.state).toEqual(a.state);
  });

  test("rejects unknown versions and garbage", () => {
    expect(() => deserializeProgram("{}")).toThrow();
    expect(() => deserializeProgram(JSON.stringify({ v: 99 }))).toThrow();
    expect(() => deserializeProgram("not json")).toThrow();
  });
});

describe("AC-3.6: pause / resume", () => {
  const pauseFrom = (setup: (d: Driver) => void) => {
    const d = started([squat({ sets: 2, reps: 5, restSec: 60 }), pushup({ stationHint: "Şınav Alanı" })]);
    setup(d);
    const before = d.status;
    d.act("PAUSE");
    expect(d.status).toBe("PAUSED");
    expect(d.state.resumeTo).toBe(before);
    return d;
  };

  test("READY resumes to READY", () => {
    const d = pauseFrom(() => {});
    d.act("RESUME");
    expect(d.status).toBe("READY");
  });

  test("SET_ACTIVE resumes through COUNTDOWN and keeps the counter", () => {
    const d = pauseFrom((x) => {
      x.beginSet();
      x.rep();
      x.rep();
    });
    d.act("RESUME");
    expect(d.status).toBe("COUNTDOWN");
    d.tick(PROGRAM_TIMING.countdownMs);
    expect(d.status).toBe("SET_ACTIVE");
    expect(d.state.set!.counted).toBe(2);
  });

  test("SET_CONFIRM resumes through COUNTDOWN to SET_ACTIVE", () => {
    const d = pauseFrom((x) => {
      x.beginSet();
      x.tick(10_000);
    });
    d.act("RESUME");
    d.tick(PROGRAM_TIMING.countdownMs);
    expect(d.status).toBe("SET_ACTIVE");
  });

  test("REST keeps the remaining time", () => {
    const d = pauseFrom((x) => {
      x.beginSet();
      for (let i = 0; i < 5; i++) x.rep();
      x.tick(20_000);
    });
    d.tick(600_000); // paused time does not count
    d.act("RESUME");
    expect(d.status).toBe("REST");
    d.tick(39_000);
    expect(d.status).toBe("REST");
    d.tick(1_000);
    expect(d.status).toBe("READY");
  });

  test("COUNTDOWN resumes to COUNTDOWN", () => {
    const d = pauseFrom((x) => x.send({ type: "READY_POSE_HELD" }));
    d.act("RESUME");
    expect(d.status).toBe("COUNTDOWN");
  });

  test("TRANSFER resumes to TRANSFER", () => {
    const d = pauseFrom((x) => {
      for (let s = 0; s < 2; s++) {
        x.beginSet();
        for (let i = 0; i < 5; i++) x.rep();
        x.tick(60_000);
      }
    });
    d.act("RESUME");
    expect(d.status).toBe("TRANSFER");
  });

  test("safety pause: SET_ACTIVE → PAUSED with the safety message; ignored elsewhere", () => {
    const d = started([squat()]);
    d.send({ type: "SAFETY_PAUSE", faultId: "knee_valgus" });
    expect(d.status).toBe("READY");
    d.beginSet();
    const cmds = d.send({ type: "SAFETY_PAUSE", faultId: "knee_valgus" });
    expect(d.status).toBe("PAUSED");
    expect(d.state.resumeTo).toBe("SET_ACTIVE");
    expect(cmds).toContainEqual({ type: "SPEAK", key: "safety.stop" });
  });
});

describe("cues (05, AC-5.2 at program level)", () => {
  test("FAULT_DETECTED is spoken only in SET_ACTIVE", () => {
    const d = started([squat()]);
    const fault = { type: "FAULT_DETECTED", faultId: "knee_valgus" } as const;
    expect(d.send(fault)).toEqual([]); // READY
    d.send({ type: "READY_POSE_HELD" });
    expect(d.send(fault)).toEqual([]); // COUNTDOWN
    d.tick(PROGRAM_TIMING.countdownMs);
    expect(d.send(fault)).toEqual([
      { type: "SPEAK", key: "cue.squat.knee_valgus" },
      { type: "SHOW", key: "cue.squat.knee_valgus" },
    ]);
    for (let i = 0; i < 10; i++) d.rep();
    expect(d.status).toBe("REST");
    expect(d.send(fault)).toEqual([]);
  });

  test("set summary is shown at set end", () => {
    const d = started([squat({ sets: 2, reps: 2 })], { faults: { squat: [{ id: "insufficient_depth", severity: "minor" }, { id: "knee_valgus", severity: "major" }] } });
    d.beginSet();
    d.rep("valid", ["knee_valgus"]);
    d.rep("faulty", ["insufficient_depth"]);
    d.rep("incomplete");
    const cmds = d.rep();
    expect(cmds).toContainEqual({
      type: "SHOW",
      key: "summary.set",
      params: { counted: 2, valid: 2, faulty: 1, incomplete: 1, mostFrequentFault: "knee_valgus" },
    });
  });
});

describe("AC-3.7: handoff between phone (owner) and tablet (executor), offline", () => {
  test("block runs on the tablet, phone advances past it, only the tablet records it", () => {
    const blocks = [squat({ sets: 1, reps: 2 }), pushup({ sets: 2, reps: 2, stationHint: "Şınav Alanı" }), squat({ sets: 1, reps: 1 })];
    const phone = started(blocks);
    phone.beginSet();
    phone.rep();
    phone.rep();
    expect(phone.status).toBe("TRANSFER");
    const qr = phone.log.find((c): c is Extract<ProgramCommand, { type: "SHOW_HANDOFF_QR" }> => c.type === "SHOW_HANDOFF_QR");
    expect(qr).toEqual({ type: "SHOW_HANDOFF_QR", cursor: { sessionId: SESSION, blockIndex: 1, setIndex: 0 } });
    expect(phone.log).toContainEqual({ type: "NAVIGATE_TO_STATION", stationHint: "Şınav Alanı" });

    // the tablet reads the QR (no network involved)
    const tablet = new Driver(config(blocks, { role: "executor", deviceId: "tablet-7", stationId: "st-7" }), phone.state.now, 1000);
    expect(tablet.status).toBe("CHECKIN");
    tablet.send({ type: "HANDOFF_ACCEPTED", cursor: qr!.cursor });
    expect(tablet.status).toBe("READY");
    for (let s = 0; s < 2; s++) {
      tablet.beginSet();
      tablet.rep();
      tablet.rep();
      if (s === 0) tablet.tick(60_000);
    }
    expect(tablet.status).toBe("IDLE");
    expect(tablet.log).toContainEqual({ type: "SHOW", key: "handoff.return_to_phone" });
    const tb = tablet.records("session_block").map((r) => r.data as { position: number; status: string; executedByDeviceId: string; sessionId: string });
    expect(tb).toEqual([expect.objectContaining({ position: 1, status: "done", executedByDeviceId: "tablet-7", sessionId: SESSION })]);
    expect(tablet.records("session")).toEqual([]); // the owner writes the session
    expect(tablet.records("set")).toHaveLength(2);

    // the member comes back to the phone
    phone.tick(10 * 60_000);
    phone.send({ type: "HANDOFF_RETURNED" });
    expect(phone.status).toBe("READY");
    expect(phone.state.cursor).toEqual({ blockIndex: 2, setIndex: 0 });
    phone.beginSet();
    phone.rep();
    expect(phone.status).toBe("SESSION_DONE");
    const phoneBlocks = phone.records("session_block").map((r) => (r.data as { position: number }).position);
    expect(phoneBlocks).toEqual([0, 2]); // nothing for the delegated block
  });

  test("the phone can run the transfer block itself with START", () => {
    const phone = started([squat({ sets: 1, reps: 1 }), pushup({ sets: 1, reps: 1, stationHint: "Şınav Alanı" })]);
    phone.beginSet();
    phone.rep();
    expect(phone.status).toBe("TRANSFER");
    phone.act("START");
    expect(phone.status).toBe("READY");
    phone.beginSet();
    phone.rep();
    expect(phone.status).toBe("SESSION_DONE");
  });

  test("a first block with a station hint starts in TRANSFER", () => {
    const phone = started([pushup({ stationHint: "Şınav Alanı" })]);
    expect(phone.status).toBe("TRANSFER");
  });

  test("transfer timeouts: 30 min → PAUSED, 2 h → ABANDONED", () => {
    const phone = started([squat({ sets: 1, reps: 1 }), pushup({ stationHint: "Şınav Alanı" })]);
    phone.beginSet();
    phone.rep();
    phone.tick(29 * 60_000);
    expect(phone.status).toBe("TRANSFER");
    phone.tick(60_000);
    expect(phone.status).toBe("PAUSED");
    expect(phone.state.resumeTo).toBe("TRANSFER");
    phone.tick(90 * 60_000);
    expect(phone.status).toBe("ABANDONED");
    expect(phone.records("session").at(-1)!.data).toMatchObject({ status: "abandoned" });
  });

  test("HANDOFF_RETURNED after the 30 min pause resumes implicitly", () => {
    const phone = started([squat({ sets: 1, reps: 1 }), pushup({ stationHint: "Şınav Alanı" }), squat()]);
    phone.beginSet();
    phone.rep();
    phone.tick(40 * 60_000);
    expect(phone.status).toBe("PAUSED");
    phone.send({ type: "HANDOFF_RETURNED" });
    expect(phone.status).toBe("READY");
    expect(phone.state.cursor.blockIndex).toBe(2);
  });

  test("executor ignores a cursor for another session", () => {
    const tablet = new Driver(config([squat()], { role: "executor" }));
    tablet.send({ type: "HANDOFF_ACCEPTED", cursor: { sessionId: uuid(999), blockIndex: 0, setIndex: 0 } });
    expect(tablet.status).toBe("CHECKIN");
  });
});

describe("AC-3.8: skip and undo", () => {
  test("undone skip produces no record", () => {
    const d = started([squat(), pushup()]);
    d.act("SKIP_BLOCK");
    expect(d.status).toBe("READY");
    expect(d.state.cursor.blockIndex).toBe(1);
    d.act("UNDO_SKIP");
    expect(d.state.cursor).toEqual({ blockIndex: 0, setIndex: 0 });
    expect(d.records("session_block")).toEqual([]);
  });

  test("skip record is written once the undo window closes (next countdown)", () => {
    const d = started([squat(), pushup()]);
    d.act("SKIP_BLOCK");
    expect(d.records("session_block")).toEqual([]);
    d.send({ type: "READY_POSE_HELD" });
    expect(d.records("session_block").map((r) => r.data)).toEqual([expect.objectContaining({ position: 0, status: "skipped" })]);
    d.tick(PROGRAM_TIMING.countdownMs);
    d.act("UNDO_SKIP");
    expect(d.status).toBe("SET_ACTIVE"); // invalid now
  });

  test("skipping during REST after some sets is partial; undo returns to the next set", () => {
    const d = started([squat({ sets: 3, reps: 1 }), pushup()]);
    d.beginSet();
    d.rep();
    expect(d.status).toBe("REST");
    d.act("SKIP_BLOCK");
    expect(d.state.cursor.blockIndex).toBe(1);
    d.act("UNDO_SKIP");
    expect(d.status).toBe("READY");
    expect(d.state.cursor).toEqual({ blockIndex: 0, setIndex: 1 });
    d.act("SKIP_BLOCK");
    d.act("ABORT");
    expect(d.records("session_block").map((r) => r.data)).toEqual([expect.objectContaining({ position: 0, status: "partial" })]);
  });

  test("skipping the last block ends the session and writes the skip", () => {
    const d = started([squat()]);
    d.act("SKIP_BLOCK");
    expect(d.status).toBe("SESSION_DONE");
    expect(d.records("session_block").map((r) => r.data)).toEqual([expect.objectContaining({ status: "skipped" })]);
  });
});

describe("AC-3.9: manual (camera-less) sets", () => {
  const manual = (reps: number) => ({ type: "MANUAL_SET", reps }) as ProgramInput;

  test("a manual set from READY writes a manual set record and no reps, then rests", () => {
    const d = started([squat({ sets: 2, reps: 10 })]);
    d.send(manual(8));
    expect(d.status).toBe("REST");
    expect(d.records("rep")).toEqual([]);
    const set = d.records("set")[0]!.data;
    expect(set).toMatchObject({ source: "manual", validReps: 8, faultyReps: 0, incompleteReps: 0, plannedReps: 10, belowTarget: true });
    expect(set).not.toHaveProperty("view");
    expect(SetRecordSchema.safeParse(set).success).toBe(true);
  });

  test("the block and session flow is the same as with the camera", () => {
    const d = started([squat({ sets: 2, reps: 5 }), pushup({ sets: 1, reps: 8 })]);
    d.send(manual(5));
    d.tick(60_000);
    d.send(manual(5));
    expect(d.state.cursor.blockIndex).toBe(1);
    expect(d.status).toBe("READY");
    d.send(manual(8));
    expect(d.status).toBe("SESSION_DONE");
    expect(d.records("set").map((r) => (r.data as { belowTarget: boolean }).belowTarget)).toEqual([false, false, false]);
    expect(d.records("session_block").map((r) => (r.data as { status: string }).status)).toEqual(["done", "done"]);
  });

  test("a timed block logged by hand is not below target", () => {
    const d = started([squat({ reps: undefined, durationSec: 30, sets: 1 })]);
    d.send(manual(0));
    expect(d.records("set")[0]!.data).toMatchObject({ source: "manual", belowTarget: false });
  });

  test("the set summary shows the logged reps", () => {
    const d = started([squat({ sets: 2, reps: 10 })]);
    expect(d.send(manual(7))).toContainEqual({ type: "SHOW", key: "summary.set", params: { counted: 7, valid: 7, faulty: 0, incomplete: 0, mostFrequentFault: "" } });
  });

  test("ignored outside READY", () => {
    const d = started([squat()]);
    d.beginSet();
    const before = structuredClone(d.state);
    expect(d.send(manual(5))).toEqual([]);
    expect(d.state).toEqual(before);
  });
});

describe("ABORT", () => {
  test("mid-set abort persists the partial set, a partial block and an aborted session", () => {
    const d = started([squat()]);
    d.beginSet();
    d.rep();
    d.act("ABORT");
    expect(d.status).toBe("ABORTED");
    expect(d.records("set").map((r) => r.data)).toEqual([expect.objectContaining({ validReps: 1, belowTarget: true })]);
    expect(d.records("session_block").map((r) => r.data)).toEqual([expect.objectContaining({ status: "partial" })]);
    expect(d.records("session").at(-1)!.data).toMatchObject({ status: "aborted" });
  });

  test("abort before any attempt writes no set", () => {
    const d = started([squat()]);
    d.act("ABORT");
    expect(d.records("set")).toEqual([]);
    expect(d.records("session_block")).toEqual([]);
  });
});

describe("timed blocks", () => {
  test("a durationSec set ends when the time is up", () => {
    const d = started([squat({ reps: undefined, durationSec: 30, sets: 1 })]);
    d.beginSet();
    d.rep(); // activity keeps inactivity away
    d.tick(9_000);
    d.rep();
    d.tick(9_000);
    d.rep();
    d.tick(12_000);
    expect(d.status).toBe("SESSION_DONE");
    expect(d.records("set")[0]!.data).toMatchObject({ belowTarget: false });
  });
});

describe("AC-3.1: transition table", () => {
  type Setup = (d: Driver) => void;
  const blocks = [squat({ sets: 2, reps: 1 }), pushup({ sets: 1, reps: 1, stationHint: "Şınav Alanı" })];
  const at: Record<string, Setup> = {
    IDLE: () => {},
    READY: (d) => d.act("START"),
    COUNTDOWN: (d) => {
      d.act("START");
      d.send({ type: "READY_POSE_HELD" });
    },
    SET_ACTIVE: (d) => {
      d.act("START");
      d.beginSet();
    },
    SET_CONFIRM: (d) => {
      d.act("START");
      d.beginSet();
      d.tick(10_000);
    },
    REST: (d) => {
      d.act("START");
      d.beginSet();
      d.rep();
    },
    TRANSFER: (d) => {
      d.act("START");
      for (let s = 0; s < 2; s++) {
        d.beginSet();
        d.rep();
        d.tick(60_000);
      }
    },
    PAUSED: (d) => {
      d.act("START");
      d.act("PAUSE");
    },
    SESSION_DONE: (d) => {
      d.act("START");
      d.act("SKIP_BLOCK");
      d.act("SKIP_BLOCK");
    },
    ABORTED: (d) => {
      d.act("START");
      d.act("ABORT");
    },
  };
  const make = (state: string) => {
    const d = new Driver(config(blocks));
    at[state]!(d);
    expect(d.status, `setup for ${state}`).toBe(state);
    return d;
  };
  const ua = (kind: string) => ({ type: "USER_ACTION", kind }) as ProgramInput;

  const valid: [string, ProgramInput, ProgramStatus][] = [
    ["IDLE", ua("START"), "READY"],
    ["READY", ua("START"), "COUNTDOWN"],
    ["READY", { type: "READY_POSE_HELD" }, "COUNTDOWN"],
    ["READY", ua("SKIP_BLOCK"), "TRANSFER"],
    ["READY", ua("PAUSE"), "PAUSED"],
    ["READY", ua("ABORT"), "ABORTED"],
    ["COUNTDOWN", { type: "TICK", now: T0 + PROGRAM_TIMING.countdownMs }, "SET_ACTIVE"],
    ["COUNTDOWN", ua("PAUSE"), "PAUSED"],
    ["COUNTDOWN", ua("ABORT"), "ABORTED"],
    ["SET_ACTIVE", { type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1500 }, "REST"],
    ["SET_ACTIVE", ua("END_SET"), "REST"],
    ["SET_ACTIVE", { type: "SAFETY_PAUSE", faultId: "knee_valgus" }, "PAUSED"],
    ["SET_ACTIVE", ua("PAUSE"), "PAUSED"],
    ["SET_ACTIVE", ua("ABORT"), "ABORTED"],
    ["SET_CONFIRM", ua("CONTINUE_SET"), "SET_ACTIVE"],
    ["SET_CONFIRM", ua("END_SET"), "REST"],
    ["SET_CONFIRM", { type: "REP_STARTED" }, "SET_ACTIVE"],
    ["SET_CONFIRM", ua("PAUSE"), "PAUSED"],
    ["REST", ua("READY"), "READY"],
    ["REST", ua("SKIP_BLOCK"), "TRANSFER"],
    ["REST", ua("PAUSE"), "PAUSED"],
    ["REST", ua("ABORT"), "ABORTED"],
    ["TRANSFER", { type: "HANDOFF_RETURNED" }, "SESSION_DONE"],
    ["TRANSFER", ua("START"), "READY"],
    ["TRANSFER", ua("SKIP_BLOCK"), "SESSION_DONE"],
    ["TRANSFER", ua("PAUSE"), "PAUSED"],
    ["TRANSFER", ua("ABORT"), "ABORTED"],
    ["PAUSED", ua("RESUME"), "READY"],
    ["PAUSED", ua("ABORT"), "ABORTED"],
  ];

  test.each(valid)("%s + %j → %s", (from, input, to) => {
    const d = make(from);
    if (input.type === "TICK") input = { type: "TICK", now: d.state.now + PROGRAM_TIMING.countdownMs };
    d.send(input);
    expect(d.status).toBe(to);
  });

  const invalid: [string, ProgramInput][] = [
    ["IDLE", ua("PAUSE")],
    ["IDLE", ua("ABORT")],
    ["IDLE", { type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1 }],
    ["IDLE", { type: "HANDOFF_ACCEPTED", cursor: { sessionId: SESSION, blockIndex: 0, setIndex: 0 } }],
    ["READY", ua("UNDO_SKIP")],
    ["READY", ua("END_SET")],
    ["READY", ua("RESUME")],
    ["READY", ua("CONTINUE_SET")],
    ["READY", { type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1 }],
    ["READY", { type: "HANDOFF_RETURNED" }],
    ["COUNTDOWN", { type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1 }],
    ["COUNTDOWN", ua("SKIP_BLOCK")],
    ["COUNTDOWN", ua("START")],
    ["SET_ACTIVE", ua("UNDO_SKIP")],
    ["SET_ACTIVE", ua("SKIP_BLOCK")],
    ["SET_ACTIVE", ua("START")],
    ["SET_ACTIVE", ua("RESUME")],
    ["SET_ACTIVE", ua("CONTINUE_SET")],
    ["SET_ACTIVE", { type: "READY_POSE_HELD" }],
    ["SET_CONFIRM", ua("UNDO_SKIP")],
    ["SET_CONFIRM", ua("SKIP_BLOCK")],
    ["REST", ua("UNDO_SKIP")],
    ["REST", ua("END_SET")],
    ["REST", ua("START")],
    ["REST", { type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1 }],
    ["REST", { type: "SAFETY_PAUSE", faultId: "knee_valgus" }],
    ["TRANSFER", ua("UNDO_SKIP")],
    ["TRANSFER", ua("END_SET")],
    ["TRANSFER", { type: "READY_POSE_HELD" }],
    ["PAUSED", ua("PAUSE")],
    ["PAUSED", ua("START")],
    ["PAUSED", ua("SKIP_BLOCK")],
    ["PAUSED", ua("UNDO_SKIP")],
    ["SESSION_DONE", ua("START")],
    ["SESSION_DONE", ua("ABORT")],
    ["SESSION_DONE", ua("PAUSE")],
    ["ABORTED", ua("RESUME")],
    ["ABORTED", ua("START")],
  ];

  test.each(invalid)("%s + %j is ignored", (from, input) => {
    const d = make(from);
    const before = structuredClone(d.state);
    const cmds = d.send(input);
    expect(cmds).toEqual([]);
    expect(d.state).toEqual(before);
  });
});
