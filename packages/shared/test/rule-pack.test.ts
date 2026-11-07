import { describe, expect, test } from "vitest";
import { parseRulePack, safeParseRulePack } from "../src/index";
import { listExerciseFiles, readExercise, squat } from "./helpers";

function issuesOf(input: unknown): string[] {
  const r = safeParseRulePack(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

/** Asserts that some issue's "path: message" contains both fragments. */
function expectInvalid(input: unknown, pathFragment: string, messageFragment = "") {
  const issues = issuesOf(input);
  expect(issues.length, "expected validation to fail").toBeGreaterThan(0);
  const match = issues.find((i) => i.includes(pathFragment) && i.includes(messageFragment));
  expect(match, `no issue matching '${pathFragment}' / '${messageFragment}' in:\n${issues.join("\n")}`).toBeDefined();
}

describe("AC-4.1: exercises/*.json conform to the rule pack schema", () => {
  const files = listExerciseFiles();

  test("rule pack files exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)("%s is valid", (file) => {
    expect(issuesOf(readExercise(file))).toEqual([]);
  });

  test.each(files)("%s file name matches its id", (file) => {
    expect(parseRulePack(readExercise(file)).id).toBe(file.replace(/\.json$/, ""));
  });
});

describe("unknown fields are rejected", () => {
  test("top level", () => {
    const p = squat();
    p.hysteresis = { upEnter: 160 };
    expectInvalid(p, "", "hysteresis");
  });

  test("inside a fault", () => {
    const p = squat();
    p.faults[0].priority = 1;
    expectInvalid(p, "faults.0");
  });

  test("inside rep zones", () => {
    const p = squat();
    p.rep.start.middle = 155;
    expectInvalid(p, "rep.start");
  });
});

describe("metric references", () => {
  test("rep.metric must be a defined metric", () => {
    const p = squat();
    p.rep.metric = "hip_angle";
    expectInvalid(p, "rep.metric", "hip_angle");
  });

  test("max must reference defined metrics", () => {
    const p = squat();
    p.metrics.m = { max: ["knee_angle_near", "nope"] };
    expectInvalid(p, "metrics.m", "nope");
    p.metrics.m = { max: ["knee_angle_near", "torso_lean"] };
    expect(parseRulePack(p).metrics.m).toEqual({ max: ["knee_angle_near", "torso_lean"] });
  });

  test("avg must reference defined metrics", () => {
    const p = squat();
    p.metrics.knee_angle_avg = { avg: ["knee_angle_l", "knee_angle_x"] };
    expectInvalid(p, "metrics.knee_angle_avg", "knee_angle_x");
  });

  test("metric-valued function rejects landmark arguments", () => {
    const p = squat();
    p.metrics.knee_angle_avg = { avg: ["left_knee", "right_knee"] };
    expectInvalid(p, "metrics.knee_angle_avg");
  });

  test("cyclic metrics are rejected", () => {
    const p = squat();
    p.metrics.a = { avg: ["b", "knee_angle_l"] };
    p.metrics.b = { absDiff: ["a", "knee_angle_r"] };
    expectInvalid(p, "metrics", "cycle");
  });

  test("metric names cannot be reserved expression words", () => {
    const p = squat();
    p.metrics.and = { angle: ["left_hip", "left_knee", "left_ankle"] };
    expectInvalid(p, "metrics.and", "reserved");
  });

  test("self-referencing metric is rejected", () => {
    const p = squat();
    p.metrics.a = { avg: ["a", "knee_angle_l"] };
    expectInvalid(p, "metrics", "cycle");
  });
});

describe("metric functions (closed list)", () => {
  test("unknown function is rejected", () => {
    const p = squat();
    p.metrics.x = { distance: ["left_hip", "left_knee"] };
    expectInvalid(p, "metrics.x");
  });

  test("exactly one function per metric", () => {
    const p = squat();
    p.metrics.x = { angle: ["left_hip", "left_knee", "left_ankle"], diffY: ["left_hip", "left_knee"] };
    expectInvalid(p, "metrics.x");
  });

  test("arity is enforced", () => {
    const p = squat();
    p.metrics.x = { angle: ["left_hip", "left_knee"] };
    expectInvalid(p, "metrics.x");
  });

  test("unknown landmark is rejected", () => {
    const p = squat();
    p.metrics.x = { diffY: ["left_hip", "left_kneecap"] };
    expectInvalid(p, "metrics.x");
  });

  test("near_/far_ only exist for bilateral landmarks", () => {
    const p = squat();
    p.metrics.x = { diffY: ["near_nose", "near_hip"] };
    expectInvalid(p, "metrics.x");
  });

  test("near_/far_ of bilateral landmarks are accepted", () => {
    const p = squat();
    p.metrics.x = { signedOffset: ["near_shoulder", "far_hip", "near_foot_index"] };
    expect(issuesOf(p)).toEqual([]);
  });

  test("minVisibleLandmarks must be landmarks", () => {
    const p = squat();
    p.camera.minVisibleLandmarks.push("knee_angle_l");
    expectInvalid(p, "camera.minVisibleLandmarks");
  });
});

describe("rep zones (hysteresis)", () => {
  test("decreasing movement: start.exit must be below start.enter", () => {
    const p = squat();
    p.rep.start = { enter: 160, exit: 170 };
    expectInvalid(p, "rep.start");
  });

  test("decreasing movement: target.exit must be above target.enter", () => {
    const p = squat();
    p.rep.target = { enter: 100, exit: 90 };
    expectInvalid(p, "rep.target");
  });

  test("zones must not overlap", () => {
    const p = squat();
    p.rep.target = { enter: 100, exit: 155 }; // above start.exit (150)
    expectInvalid(p, "rep", "overlap");
  });

  test("increasing movement is accepted when mirrored", () => {
    const p = squat();
    p.rep.start = { enter: 95, exit: 105 };
    p.rep.target = { enter: 160, exit: 150 };
    p.readyPose = "knee_angle_avg < 100 for 1500ms";
    expect(issuesOf(p)).toEqual([]);
  });

  test("increasing movement: start.exit must be above start.enter", () => {
    const p = squat();
    p.rep.start = { enter: 95, exit: 90 };
    p.rep.target = { enter: 160, exit: 150 };
    expectInvalid(p, "rep.start");
  });

  test("start.enter must differ from target.enter", () => {
    const p = squat();
    p.rep.target = { enter: 160, exit: 165 };
    expectInvalid(p, "rep", "must differ");
  });

  test("minDurationMs must be below maxDurationMs", () => {
    const p = squat();
    p.rep.minDurationMs = 9000;
    expectInvalid(p, "rep", "maxDurationMs");
  });
});

describe("faults", () => {
  test("defaults are applied", () => {
    const p = squat();
    for (const f of p.faults) {
      delete f.cooldownMs;
      delete f.minConsecutiveReps;
    }
    delete p.camera.minVisibility;
    delete p.camera.posture;
    const parsed = parseRulePack(p);
    expect(parsed.camera.minVisibility).toBe(0.6);
    expect(parsed.camera.posture).toBe("standing");
    for (const f of parsed.faults) {
      expect(f.cooldownMs).toBe(4000);
      expect(f.minConsecutiveReps).toBe(1);
    }
  });

  test("camera.posture accepts standing or horizontal only", () => {
    const p = squat();
    p.camera.posture = "horizontal";
    expect(parseRulePack(p).camera.posture).toBe("horizontal");
    p.camera.posture = "sitting";
    expectInvalid(p, "camera.posture");
  });

  test("holdMs defaults to 150 for during_rep faults only", () => {
    const parsed = parseRulePack(squat());
    const byId = Object.fromEntries(parsed.faults.map((f) => [f.id, f]));
    expect(byId.knee_valgus?.holdMs).toBe(150);
    expect(byId.insufficient_depth?.holdMs).toBeUndefined();
  });

  test("holdMs is rejected on non-during_rep faults", () => {
    const p = squat();
    p.faults[0].holdMs = 200; // insufficient_depth is at_turn
    expectInvalid(p, "faults.0.holdMs", "during_rep");
  });

  test("check must start with a known position", () => {
    const p = squat();
    p.faults[0].check = "at_phase_bottom: knee_angle_avg > 100";
    expectInvalid(p, "faults.0.check");
  });

  test("fault views must be a subset of camera.views", () => {
    const p = squat();
    p.camera.views = ["front"];
    expectInvalid(p, "faults.2.views", "side"); // excessive_forward_lean is side-only
  });

  test("fault ids must be unique", () => {
    const p = squat();
    p.faults[1].id = p.faults[0].id;
    expectInvalid(p, "faults.1.id", "duplicate");
  });

  test("faults need a localized name (A3 active checks)", () => {
    const p = squat();
    delete p.faults[0].name;
    expectInvalid(p, "faults.0.name");
  });

  test("cue needs both tr and en", () => {
    const p = squat();
    delete p.faults[0].cue.en;
    expectInvalid(p, "faults.0.cue");
  });
});

describe("top-level constraints", () => {
  test("hold type is rejected in MVP", () => {
    const p = squat();
    p.type = "hold";
    expectInvalid(p, "type", "MVP");
  });

  test("status must be draft or calibrated", () => {
    const p = squat();
    p.status = "draft-thresholds-need-calibration";
    expectInvalid(p, "status");
  });

  test("readyPose must end with a duration", () => {
    const p = squat();
    p.readyPose = "knee_angle_avg > 165";
    expectInvalid(p, "readyPose");
  });

  test("camera.views cannot be empty or contain ambiguous", () => {
    const empty = squat();
    empty.camera.views = [];
    expectInvalid(empty, "camera.views");
    const ambiguous = squat();
    ambiguous.camera.views = ["front", "ambiguous"];
    expectInvalid(ambiguous, "camera.views");
  });

  test("version must be a positive integer", () => {
    const p = squat();
    p.version = 0;
    expectInvalid(p, "version");
  });
});
