import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EngineEvent, ProgramInput } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import {
  ExerciseEngine,
  type ProgramCommand,
  type ProgramState,
  chooseNearSide,
  createProgram,
  detectView,
  dominantView,
  loadRulePack,
  step,
} from "../src/index";
import { squatSequence } from "../src/testing/index";

// Camera-free end-to-end: synthetic frames → ExerciseEngine → program state machine.
const squat = loadRulePack(JSON.parse(readFileSync(fileURLToPath(new URL("../../../exercises/squat.json", import.meta.url)), "utf8")));
const T0 = Date.UTC(2026, 10, 6, 9);

describe("pipeline: frames to SESSION_DONE", () => {
  test("one set of 3 squats (one shallow) in strict mode", () => {
    const seq = squatSequence({
      view: "front",
      reps: [{ kneeAngle: 90 }, { kneeAngle: 120 }, { kneeAngle: 92 }, { kneeAngle: 90 }],
      noise: 0.002,
      seed: 4,
      // ready pose (1.5 s) + countdown (3 s) must pass before the first rep; reps during COUNTDOWN are ignored
      leadInMs: 5000,
    });
    const setupFrames = seq.frames.slice(0, 30);
    const engine = new ExerciseEngine(squat, {
      view: dominantView(setupFrames.map((f) => detectView(f))),
      nearSide: chooseNearSide(setupFrames),
    });

    let n = 0;
    let state: ProgramState = createProgram(
      {
        role: "owner",
        workout: { id: "w", name: "A", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 3, restSec: 60, mode: "strict" }] },
        sessionId: "11111111-1111-4111-8111-111111111111",
        memberId: "m",
        memberProgramId: "p",
        workoutDayIndex: 0,
        deviceId: "phone",
        faults: { squat: squat.pack.faults },
      },
      T0,
    );
    const commands: ProgramCommand[] = [];
    const send = (input: ProgramInput) => {
      const r = step(state, input, { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
      state = r.state;
      commands.push(...r.commands);
    };

    send({ type: "USER_ACTION", kind: "START" });
    const engineEvents: EngineEvent[] = [];
    for (const frame of seq.frames) {
      send({ type: "TICK", now: T0 + frame.t });
      engine.setCuesEnabled(state.status === "SET_ACTIVE"); // what the web app does (T2.4)
      for (const e of engine.push(frame)) {
        engineEvents.push(e);
        send(e);
      }
      if (state.status === "SESSION_DONE") break;
    }

    expect(state.status).toBe("SESSION_DONE");
    const reps = commands.flatMap((c) => (c.type === "PERSIST_EVENT" && c.record.kind === "rep" ? [c.record.data] : []));
    expect(reps.map((r) => r.outcome)).toContain("faulty");
    expect(reps.filter((r) => r.outcome === "valid")).toHaveLength(3);
    expect(commands).toContainEqual({ type: "SPEAK", key: "cue.squat.insufficient_depth" });
    const summary = commands.find((c) => c.type === "SHOW" && c.key === "summary.set");
    expect(summary).toMatchObject({ params: { counted: 3, valid: 3, faulty: 1, mostFrequentFault: "insufficient_depth" } });
  });
});
