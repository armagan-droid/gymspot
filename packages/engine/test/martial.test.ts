import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EngineEvent } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { ExerciseEngine, type ExerciseSetup, loadRulePack } from "../src/index";
import { fighterFrame, fighterSequence, playSequence } from "../src/testing/index";

// Martial-arts technique packs on synthetic fighters (specs/00 "Dövüş sporları", 04, T6.2).

const load = (id: string) =>
  loadRulePack(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8")));
// side view, facing right: the person's left side is near the camera
const SIDE: ExerciseSetup = { view: "side", nearSide: "left" };

function run(id: string, seq: ReturnType<typeof fighterSequence>): EngineEvent[] {
  const engine = new ExerciseEngine(load(id), SIDE);
  return playSequence(seq, (f) => engine.push(f));
}
const outcomes = (ev: EngineEvent[]) => ev.flatMap((e) => (e.type === "REP_COMPLETED" ? [e.outcome] : []));
const cues = (ev: EngineEvent[]) => ev.flatMap((e) => (e.type === "FAULT_DETECTED" ? [e.faultId] : []));
const fast = { durationMs: 600 };

describe("teep / mae geri: kick height", () => {
  test("teeps to hip height count, with either leg", () => {
    for (const kickSide of ["left", "right"] as const) {
      const seq = fighterSequence({ exerciseId: "teep", kickSide, reps: [0, 1, 2].map(() => ({ hipFlex: 90, kneeAngle: 170, torsoLean: 15, ...fast })) });
      expect(outcomes(run("teep", seq)), kickSide).toEqual(["valid", "valid", "valid"]);
    }
  });

  test("a low kick is an attempt that does not count", () => {
    const seq = fighterSequence({ exerciseId: "teep", reps: [{ hipFlex: 70, kneeAngle: 170, ...fast }] });
    expect(outcomes(run("teep", seq))).toEqual(["incomplete"]);
  });

  test("mae geri asks for hip height; a teep-height kick is not enough", () => {
    const high = fighterSequence({ exerciseId: "mae_geri", reps: [{ hipFlex: 95, kneeAngle: 175, ...fast }] });
    const teepHeight = fighterSequence({ exerciseId: "mae_geri", reps: [{ hipFlex: 85, kneeAngle: 165, ...fast }] });
    expect(outcomes(run("mae_geri", high))).toEqual(["valid"]);
    expect(outcomes(run("mae_geri", teepHeight))).toEqual(["incomplete"]);
  });

  test("leaning back at the kick is cued on mae geri, tolerated on teep", () => {
    const kick = { hipFlex: 95, kneeAngle: 175, torsoLean: 35, ...fast };
    const maeGeri = run("mae_geri", fighterSequence({ exerciseId: "mae_geri", reps: [kick, kick] }));
    const teep = run("teep", fighterSequence({ exerciseId: "teep", reps: [kick, kick] }));
    expect(cues(maeGeri)).toContain("excessive_lean");
    expect(cues(teep)).not.toContain("excessive_lean");
  });

  test("dropping the guard during the kick is cued", () => {
    const seq = fighterSequence({ exerciseId: "teep", reps: [{ hipFlex: 90, kneeAngle: 170, guardDrop: 1, durationMs: 1200 }] });
    expect(cues(run("teep", seq))).toContain("guard_dropped");
  });
});

describe("knee strike", () => {
  test("knees above the hip count; a half knee does not", () => {
    const seq = fighterSequence({ exerciseId: "knee_strike", reps: [{ hipFlex: 105, kneeAngle: 50, ...fast }, { hipFlex: 75, kneeAngle: 70, ...fast }] });
    expect(outcomes(run("knee_strike", seq))).toEqual(["valid", "incomplete"]);
  });
});

describe("straight punch", () => {
  test("jabs and crosses count, with either arm", () => {
    for (const punchSide of ["left", "right"] as const) {
      const seq = fighterSequence({ exerciseId: "straight_punch", punchSide, reps: [0, 1, 2, 3].map(() => ({ punchElbow: 175, durationMs: 400 })) });
      expect(outcomes(run("straight_punch", seq)), punchSide).toEqual(["valid", "valid", "valid", "valid"]);
    }
  });

  test("dropping the hands is not a punch (the elbow straightens, the arm does not lift)", () => {
    const seq = fighterSequence({ exerciseId: "straight_punch", reps: [{ guardDrop: 1, punchElbow: 35 }] });
    const ev = run("straight_punch", seq);
    expect(ev.filter((e) => e.type === "REP_STARTED")).toHaveLength(0);
  });

  test("a half punch is an attempt that does not count", () => {
    const seq = fighterSequence({ exerciseId: "straight_punch", reps: [{ punchElbow: 110, durationMs: 400 }] });
    expect(outcomes(run("straight_punch", seq))).toEqual(["incomplete"]);
  });
});

describe("ready pose: guard", () => {
  test("holding the guard for a second is the ready pose; hands down is not", () => {
    for (const [guardDrop, expected] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const engine = new ExerciseEngine(load("straight_punch"), SIDE);
      const ev: EngineEvent[] = [];
      for (let t = 0; t <= 1500; t += 33) ev.push(...engine.push(fighterFrame({ guardDrop }, { view: "side", t })));
      expect(ev.filter((e) => e.type === "READY_POSE_HELD"), `guardDrop=${guardDrop}`).toHaveLength(expected);
    }
  });
});

describe("noise (agile smoothing must not invent techniques)", () => {
  test("standing in guard with landmark jitter counts nothing in any pack", () => {
    for (const id of ["teep", "mae_geri", "knee_strike", "straight_punch"]) {
      const still = fighterSequence({ exerciseId: id, reps: [], leadInMs: 6000, noise: 0.006, seed: 7 });
      expect(run(id, still).filter((e) => e.type === "REP_STARTED"), id).toHaveLength(0);
    }
  });

  test("techniques still count with the same jitter", () => {
    const teep = fighterSequence({ exerciseId: "teep", noise: 0.006, seed: 3, reps: [0, 1, 2].map(() => ({ hipFlex: 90, kneeAngle: 170, ...fast })) });
    const punch = fighterSequence({ exerciseId: "straight_punch", noise: 0.006, seed: 3, reps: [0, 1, 2].map(() => ({ punchElbow: 175, durationMs: 400 })) });
    expect(outcomes(run("teep", teep))).toEqual(["valid", "valid", "valid"]);
    expect(outcomes(run("straight_punch", punch))).toEqual(["valid", "valid", "valid"]);
  });
});
