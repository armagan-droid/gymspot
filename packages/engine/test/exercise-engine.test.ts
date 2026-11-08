import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type EngineEvent, type Frame, LANDMARK_NAMES, type LandmarkName } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { ExerciseEngine, type ExerciseSetup, loadRulePack, summarizeSet } from "../src/index";
import { type SquatParams, repTimeline, squatFrame } from "../src/testing/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (id: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8"));
const squat = loadRulePack(raw("squat"));

const STANDING: Required<SquatParams> = { kneeAngle: 172, torsoLean: 5, valgus: 0 };

/** Squat frames: each rep interpolates from standing to its own params. */
function squatFrames(
  view: "front" | "side",
  reps: Partial<SquatParams>[],
  o: { restMs?: number; durationMs?: number; leadInMs?: number; leadOutMs?: number; facing?: "left" | "right" } = {},
): Frame[] {
  const tl = repTimeline({
    fps: 30,
    reps: reps.map(() => ({ durationMs: o.durationMs ?? 2000 })),
    leadInMs: o.leadInMs ?? 2000,
    restMs: o.restMs ?? 800,
    leadOutMs: o.leadOutMs ?? 1000,
  });
  return tl.map((p) => {
    const target = p.repIndex === null ? STANDING : { ...STANDING, kneeAngle: 90, torsoLean: 25, ...reps[p.repIndex] };
    const s = p.progress;
    const params = {
      kneeAngle: STANDING.kneeAngle + (target.kneeAngle - STANDING.kneeAngle) * s,
      torsoLean: STANDING.torsoLean + (target.torsoLean - STANDING.torsoLean) * s,
      valgus: STANDING.valgus + (target.valgus - STANDING.valgus) * s,
    };
    return squatFrame(params, { view, t: p.t, facing: o.facing });
  });
}

function setVisibility(f: Frame, names: LandmarkName[], v: number): Frame {
  const image = f.image.map((p, i) => (names.includes(LANDMARK_NAMES[i]!) ? { ...p, visibility: v } : p));
  return { ...f, image };
}

function run(frames: Frame[], setup: ExerciseSetup, engine = new ExerciseEngine(squat, setup)): EngineEvent[] {
  return frames.flatMap((f) => engine.push(f));
}

const of = <T extends EngineEvent["type"]>(ev: EngineEvent[], type: T) =>
  ev.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);
const cues = (ev: EngineEvent[]) => of(ev, "FAULT_DETECTED").map((e) => e.faultId);
const front: ExerciseSetup = { view: "front", nearSide: "left" };
const side: ExerciseSetup = { view: "side", nearSide: "left" };

describe("reps and outcomes", () => {
  test("clean reps are valid and silent", () => {
    const ev = run(squatFrames("front", [{}, {}, {}]), front);
    expect(of(ev, "REP_STARTED")).toHaveLength(3);
    expect(of(ev, "REP_COMPLETED").map((e) => e.outcome)).toEqual(["valid", "valid", "valid"]);
    expect(cues(ev)).toEqual([]);
  });

  test("durationMs is an integer", () => {
    const [rep] = of(run(squatFrames("front", [{}]), front), "REP_COMPLETED");
    expect(Number.isInteger(rep!.durationMs)).toBe(true);
    expect(rep!.durationMs).toBeGreaterThan(800);
  });

  test("AC-4.5: a partial squat is faulty with insufficient_depth and is cued", () => {
    const ev = run(squatFrames("front", [{}, { kneeAngle: 120 }]), front);
    const reps = of(ev, "REP_COMPLETED");
    expect(reps.map((r) => r.outcome)).toEqual(["valid", "faulty"]);
    expect(reps[1]!.faults).toEqual(["insufficient_depth"]);
    expect(cues(ev)).toEqual(["insufficient_depth"]);
  });

  test("a non-validity fault is recorded but the rep stays valid", () => {
    const ev = run(squatFrames("front", [{ valgus: 0.25 }]), front);
    const [rep] = of(ev, "REP_COMPLETED");
    expect(rep!.outcome).toBe("valid");
    expect(rep!.faults).toEqual(["knee_valgus"]);
  });

  test("events in a completing frame are ordered FAULT_DETECTED, REP_COMPLETED", () => {
    const ev = run(squatFrames("front", [{ kneeAngle: 120 }]), front);
    const types = ev.map((e) => e.type).filter((t) => t !== "READY_POSE_HELD");
    expect(types).toEqual(["REP_STARTED", "FAULT_DETECTED", "REP_COMPLETED"]);
  });
});

describe("AC-4.6: view and visibility gating", () => {
  test("knee_valgus (front only) is not evaluated in side view", () => {
    const ev = run(squatFrames("side", [{ valgus: 0.25 }]), side);
    expect(of(ev, "REP_COMPLETED")[0]!.faults).not.toContain("knee_valgus");
  });

  test("excessive_forward_lean (side only) is not evaluated in front view", () => {
    const frames = squatFrames("front", [{ torsoLean: 70 }, { torsoLean: 70 }]);
    const ev = run(frames, front);
    expect(of(ev, "REP_COMPLETED").flatMap((r) => r.faults)).not.toContain("excessive_forward_lean");
    // …but it is in side view
    const sideEv = run(squatFrames("side", [{ torsoLean: 70 }, { torsoLean: 70 }]), side);
    expect(of(sideEv, "REP_COMPLETED").flatMap((r) => r.faults)).toContain("excessive_forward_lean");
  });

  test("side view: depth fault and ready pose work despite the occluded far leg", () => {
    // regression: a two-leg average metric is gated by the far side's low visibility
    const ev = run(squatFrames("side", [{}, { kneeAngle: 120 }]), side);
    expect(of(ev, "READY_POSE_HELD").length).toBeGreaterThan(0);
    expect(of(ev, "REP_COMPLETED").map((r) => r.outcome)).toEqual(["valid", "faulty"]);
    expect(of(ev, "REP_COMPLETED")[1]!.faults).toEqual(["insufficient_depth"]);
  });

  test("near side comes from the setup (left-facing side view uses the right side)", () => {
    const frames = squatFrames("side", [{ torsoLean: 70 }, { torsoLean: 70 }], { facing: "left" });
    const right = run(frames, { view: "side", nearSide: "right" });
    expect(of(right, "REP_COMPLETED").flatMap((r) => r.faults)).toContain("excessive_forward_lean");
    // the far (left) side has low visibility, so a wrong near side suppresses the fault
    const wrong = run(frames, { view: "side", nearSide: "left" });
    expect(of(wrong, "REP_COMPLETED").flatMap((r) => r.faults)).not.toContain("excessive_forward_lean");
  });

  test("in an ambiguous view only faults valid for both views are evaluated", () => {
    const ev = run(squatFrames("front", [{ valgus: 0.25, kneeAngle: 120 }]), { view: "ambiguous", nearSide: "left" });
    expect(of(ev, "REP_COMPLETED")[0]!.faults).toEqual(["insufficient_depth"]);
  });

  test("low visibility on a fault's landmarks suppresses that fault", () => {
    const frames = squatFrames("front", [{ valgus: 0.25 }]).map((f) => setVisibility(f, ["right_knee"], 0.3));
    const ev = run(frames, front);
    expect(of(ev, "REP_COMPLETED")[0]!.faults).toEqual([]);
    expect(cues(ev)).toEqual([]);
  });
});

describe("during_rep holdMs", () => {
  test("a spike shorter than holdMs is ignored, a sustained one is detected", () => {
    const base = squatFrames("front", [{}, {}]);
    // rep windows start at 2000 and 4800 ms; turn points at 3000 and 5800
    const spike = (from: number, to: number) => (f: Frame) =>
      f.t >= from && f.t < to ? squatFrame({ kneeAngle: 100, torsoLean: 20, valgus: 0.3 }, { view: "front", t: f.t }) : f;
    const short = base.map(spike(2950, 3050)); // ~3 frames ≈ 67–100 ms
    expect(of(run(short, front), "REP_COMPLETED")[0]!.faults).toEqual([]);
    const long = base.map(spike(2900, 3150)); // ~8 frames ≈ 233 ms
    expect(of(run(long, front), "REP_COMPLETED")[0]!.faults).toEqual(["knee_valgus"]);
  });
});

describe("cue rules (05, AC-5.1)", () => {
  test("cooldown: the same fault is not repeated within cooldownMs", () => {
    // reps 2.8 s apart, cooldown 4 s -> cue on reps 1 and 3 only
    const ev = run(squatFrames("front", [{ valgus: 0.25 }, { valgus: 0.25 }, { valgus: 0.25 }]), front);
    expect(of(ev, "REP_COMPLETED").every((r) => r.faults.includes("knee_valgus"))).toBe(true);
    expect(cues(ev)).toEqual(["knee_valgus", "knee_valgus"]);
    const times = ev.flatMap((e, i) => (e.type === "FAULT_DETECTED" ? [i] : []));
    expect(times).toHaveLength(2);
  });

  test("minConsecutiveReps: cue only once the fault repeats in consecutive attempts", () => {
    // excessive_forward_lean needs 2 consecutive attempts
    const once = run(squatFrames("side", [{ torsoLean: 70 }, {}, { torsoLean: 70 }]), side);
    expect(cues(once)).not.toContain("excessive_forward_lean");
    const twice = run(squatFrames("side", [{ torsoLean: 70 }, { torsoLean: 70 }]), side);
    expect(cues(twice)).toEqual(["excessive_forward_lean"]);
  });

  test("priority: major beats minor in the same moment, others are dropped", () => {
    const pack = raw("squat");
    pack.faults[1].check = "at_turn: knee_valgus_l > 0.15 or knee_valgus_r > 0.15"; // knee_valgus (major) now at_turn
    const engine = new ExerciseEngine(loadRulePack(pack), front);
    // (valgus also bends the 3D knee angle, so keep it moderate to stay short of the target)
    const ev = run(squatFrames("front", [{ kneeAngle: 125, valgus: 0.2 }]), front, engine);
    expect(of(ev, "REP_COMPLETED")[0]!.faults).toEqual(["insufficient_depth", "knee_valgus"]);
    expect(cues(ev)).toEqual(["knee_valgus"]);
  });

  test("priority: equal severity goes to rule pack order", () => {
    const pack = raw("squat");
    pack.faults[2].minConsecutiveReps = 1; // excessive_forward_lean (minor, at_turn)
    const engine = new ExerciseEngine(loadRulePack(pack), side);
    const ev = run(squatFrames("side", [{ kneeAngle: 120, torsoLean: 70 }]), side, engine);
    expect(of(ev, "REP_COMPLETED")[0]!.faults).toEqual(["insufficient_depth", "excessive_forward_lean"]);
    expect(cues(ev)).toEqual(["insufficient_depth"]);
  });
});

describe("AC-5.2: cues can be switched off (rest, countdown, paused)", () => {
  test("no FAULT_DETECTED while disabled; faults are still recorded; cooldown is not consumed", () => {
    const engine = new ExerciseEngine(squat, front);
    const frames = squatFrames("front", [{ valgus: 0.25 }, { valgus: 0.25 }]);
    const split = frames.findIndex((f) => f.t >= 4400); // between rep 1 and rep 2
    engine.setCuesEnabled(false);
    const first = run(frames.slice(0, split), front, engine);
    expect(cues(first)).toEqual([]);
    expect(of(first, "REP_COMPLETED")[0]!.faults).toEqual(["knee_valgus"]);
    engine.setCuesEnabled(true);
    const second = run(frames.slice(split), front, engine);
    expect(cues(second)).toEqual(["knee_valgus"]); // within 4 s of rep 1, but rep 1 was never cued
  });
});

describe("AC-5.6: safety pause", () => {
  test("a major fault in two consecutive attempts pauses the set", () => {
    const ev = run(squatFrames("front", [{ valgus: 0.25 }, { valgus: 0.25 }]), front);
    expect(of(ev, "SAFETY_PAUSE").map((e) => e.faultId)).toEqual(["knee_valgus"]);
    // fires during the second attempt, before it completes
    const idx = ev.findIndex((e) => e.type === "SAFETY_PAUSE");
    expect(of(ev.slice(0, idx), "REP_COMPLETED")).toHaveLength(1);
  });

  test("non-consecutive major faults do not pause", () => {
    const ev = run(squatFrames("front", [{ valgus: 0.25 }, {}, { valgus: 0.25 }]), front);
    expect(of(ev, "SAFETY_PAUSE")).toEqual([]);
  });

  test("can be disabled by the gym setting", () => {
    const engine = new ExerciseEngine(squat, front, { safetyPause: false });
    const ev = run(squatFrames("front", [{ valgus: 0.25 }, { valgus: 0.25 }]), front, engine);
    expect(of(ev, "SAFETY_PAUSE")).toEqual([]);
  });

  test("reset() starts a new set: streaks are cleared", () => {
    const engine = new ExerciseEngine(squat, front);
    run(squatFrames("front", [{ valgus: 0.25 }]), front, engine);
    engine.reset();
    const ev = run(squatFrames("front", [{ valgus: 0.25 }]).map((f) => ({ ...f, t: f.t + 100_000 })), front, engine);
    expect(of(ev, "SAFETY_PAUSE")).toEqual([]);
  });
});

describe("tracking and ready pose", () => {
  const ALL_LEGS: LandmarkName[] = ["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];

  test("TRACKING_LOST after 1 s below minVisibility, TRACKING_RESTORED when back", () => {
    const frames = squatFrames("front", [], { leadInMs: 4000 }).map((f) =>
      f.t >= 1000 && f.t < 2500 ? setVisibility(f, ALL_LEGS, 0.1) : f,
    );
    const ev = run(frames, front).filter((e) => e.type.startsWith("TRACKING"));
    expect(ev.map((e) => e.type)).toEqual(["TRACKING_LOST", "TRACKING_RESTORED"]);
  });

  test("during a set, flicker just under minVisibility is not a loss (only below half of it)", () => {
    // motion blur on a phone camera: ankles hover around 0.4–0.5 for seconds
    const frames = squatFrames("front", [{}, {}], { leadInMs: 4000 }).map((f) => (f.t >= 1000 ? setVisibility(f, ALL_LEGS, 0.4) : f));
    const ev = run(frames, front);
    expect(ev.filter((e) => e.type.startsWith("TRACKING"))).toEqual([]);
    expect(of(ev, "REP_COMPLETED")).toHaveLength(2);
  });

  test("a dip shorter than 1 s is ignored", () => {
    const frames = squatFrames("front", [], { leadInMs: 4000 }).map((f) =>
      f.t >= 1000 && f.t < 1600 ? setVisibility(f, ALL_LEGS, 0.1) : f,
    );
    expect(run(frames, front).filter((e) => e.type.startsWith("TRACKING"))).toEqual([]);
  });

  test("READY_POSE_HELD fires once after holding the ready pose, and re-arms after leaving it", () => {
    const ev = run(squatFrames("front", [{}], { leadInMs: 2000, leadOutMs: 3000 }), front);
    const idx = ev.map((e) => e.type);
    expect(idx.filter((t) => t === "READY_POSE_HELD").length).toBe(2); // before the rep and after returning
    expect(idx.indexOf("READY_POSE_HELD")).toBeLessThan(idx.indexOf("REP_STARTED"));
  });

  test("ready pose requires visibility of its landmarks", () => {
    const frames = squatFrames("front", [], { leadInMs: 3000 }).map((f) => setVisibility(f, ["left_knee"], 0.2));
    expect(of(run(frames, front), "READY_POSE_HELD")).toEqual([]);
  });
});

describe("AC-5.4: set summary", () => {
  const reps = (list: [string, string[]][]) => list.map(([outcome, faults]) => ({ outcome, faults })) as never;

  test("counts and most frequent fault", () => {
    const s = summarizeSet(
      reps([
        ["valid", []],
        ["valid", ["knee_valgus"]],
        ["faulty", ["insufficient_depth"]],
        ["valid", ["knee_valgus"]],
        ["incomplete", []],
      ]),
      squat.pack.faults,
      "strict",
    );
    expect(s).toEqual({ counted: 3, valid: 3, faulty: 1, incomplete: 1, mostFrequentFault: "knee_valgus", frequentFaults: [] });
  });

  test("lenient mode counts faulty reps", () => {
    const s = summarizeSet(reps([["valid", []], ["faulty", ["insufficient_depth"]]]), squat.pack.faults, "lenient");
    expect(s.counted).toBe(2);
  });

  test("ties go to severity, then rule pack order", () => {
    const s = summarizeSet(
      reps([
        ["faulty", ["insufficient_depth"]],
        ["valid", ["knee_valgus"]],
      ]),
      squat.pack.faults,
      "strict",
    );
    expect(s.mostFrequentFault).toBe("knee_valgus"); // major
    const t = summarizeSet(
      reps([
        ["valid", ["excessive_forward_lean"]],
        ["faulty", ["insufficient_depth"]],
      ]),
      squat.pack.faults,
      "strict",
    );
    expect(t.mostFrequentFault).toBe("insufficient_depth"); // both minor, earlier in pack
  });

  test("a fault in 3 consecutive attempts is marked frequent", () => {
    const s = summarizeSet(
      reps([
        ["valid", ["knee_valgus"]],
        ["valid", ["knee_valgus"]],
        ["valid", []],
        ["valid", ["excessive_forward_lean"]],
        ["valid", ["excessive_forward_lean"]],
        ["valid", ["excessive_forward_lean"]],
      ]),
      squat.pack.faults,
      "strict",
    );
    expect(s.frequentFaults).toEqual(["excessive_forward_lean"]);
  });

  test("empty set", () => {
    expect(summarizeSet([], squat.pack.faults, "strict")).toEqual({
      counted: 0,
      valid: 0,
      faulty: 0,
      incomplete: 0,
      mostFrequentFault: null,
      frequentFaults: [],
    });
  });
});
