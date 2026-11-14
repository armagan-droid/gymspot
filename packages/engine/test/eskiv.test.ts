import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EngineEvent } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { ExerciseEngine, createMetricComputer, loadRulePack } from "../src/index";
import { evaderFrame, evaderSequence, mirrorFrame, playSequence } from "../src/testing/index";

// Head-movement drills on a synthetic front-facing boxer (specs/04 "Eskiv", T6.7).

const IDS = ["slip", "slip_left", "slip_right", "duck"] as const;
const load = (id: string) =>
  loadRulePack(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8")));

function run(id: string, seq: ReturnType<typeof evaderSequence>): EngineEvent[] {
  const engine = new ExerciseEngine(load(id), { view: "front", nearSide: "left" });
  return playSequence(seq, (f) => engine.push(f));
}
const outcomes = (ev: EngineEvent[]) => ev.flatMap((e) => (e.type === "REP_COMPLETED" ? [e.outcome] : []));
const cues = (ev: EngineEvent[]) => ev.flatMap((e) => (e.type === "FAULT_DETECTED" ? [e.faultId] : []));
const slipTo = (slip: number) => ({ slip, durationMs: 700 });

describe("metric functions", () => {
  const c = createMetricComputer({
    lean: { lateralLean: ["nose", "left_hip"] },
    height: { chainHeight: ["nose", "left_shoulder", "left_hip", "left_knee", "left_ankle"] },
  });

  test("lateralLean is signed toward the person's anatomical left", () => {
    const left = c.compute(evaderFrame({ slip: 25 }, { view: "front" }), "left").lean!;
    const right = c.compute(evaderFrame({ slip: -25 }, { view: "front" }), "left").lean!;
    expect(left).toBeGreaterThan(0.2);
    expect(right).toBeLessThan(-0.2);
  });

  test("a mirrored picture of a left slip reads as an equal right slip", () => {
    const { metrics } = load("slip").pack;
    const m = createMetricComputer(metrics);
    const frame = evaderFrame({ slip: 25 }, { view: "front" });
    const v = m.compute(frame, "left");
    const mv = m.compute(mirrorFrame(frame), "left");
    expect(mv.head_right).toBeCloseTo(v.head_left!, 6);
    expect(mv.head_slip).toBeCloseTo(v.head_slip!, 6);
  });

  test("lateralLean is unknown when the person stands sideways", () => {
    expect(c.compute(evaderFrame({ slip: 25 }, { view: "side" }), "left").lean).toBeNaN();
  });

  test("chainHeight is about 1 standing, smaller in a duck, and independent of body size", () => {
    const stand = c.compute(evaderFrame({ kneeAngle: 180 }, { view: "front" }), "left").height!;
    const duck = c.compute(evaderFrame({ kneeAngle: 110, torsoLean: 25 }, { view: "front" }), "left").height!;
    expect(stand).toBeGreaterThan(0.94);
    expect(duck).toBeLessThan(0.85);
    const big = evaderFrame({ kneeAngle: 110, torsoLean: 25 }, { view: "front" });
    big.world = big.world.map((p) => ({ ...p, x: p.x * 1.2, y: p.y * 1.2, z: p.z * 1.2 }));
    expect(c.compute(big, "left").height).toBeCloseTo(duck, 6);
  });
});

describe("packs", () => {
  test("load, front view only, explain how to do it, and the drawn head target matches the counting threshold", () => {
    for (const id of IDS) {
      const { pack } = load(id);
      expect(pack.camera.views, id).toEqual(["front"]);
      expect(pack.howTo?.tr, id).toBeTruthy();
      expect(pack.howTo?.en, id).toBeTruthy();
      const ht = pack.overlay?.headTarget;
      expect(ht, id).toBeDefined();
      expect(ht!.lateral ?? ht!.height, id).toBe(pack.rep.target.enter);
    }
  });
});

describe("slip", () => {
  test("slips to both sides count; each one-sided pack counts only its own side", () => {
    const seq = evaderSequence({ exerciseId: "slip", reps: [slipTo(25), slipTo(-25), slipTo(25), slipTo(-25)] });
    expect(outcomes(run("slip", seq))).toEqual(["valid", "valid", "valid", "valid"]);
    expect(outcomes(run("slip_left", { ...seq, exerciseId: "slip_left" }))).toEqual(["valid", "valid"]);
    expect(outcomes(run("slip_right", { ...seq, exerciseId: "slip_right" }))).toEqual(["valid", "valid"]);
  });

  test("a small lean is an attempt that does not count", () => {
    const seq = evaderSequence({ exerciseId: "slip", reps: [slipTo(15)] });
    expect(outcomes(run("slip", seq))).toEqual(["incomplete"]);
  });

  test("no new slip starts before the head comes back to the center", () => {
    // left, then straight across to the right without passing the center zone's exit
    const seq = evaderSequence({ exerciseId: "slip", reps: [{ slip: 25, durationMs: 700 }], restMs: 0, leadOutMs: 0 });
    const held = evaderSequence({ exerciseId: "slip", start: { slip: 25 }, reps: [], leadInMs: 1500, leadOutMs: 0 });
    const frames = [...seq.frames.slice(0, Math.floor(seq.frames.length / 2)), ...held.frames.map((f, i) => ({ ...f, t: seq.frames[Math.floor(seq.frames.length / 2)]!.t + i * 33 }))];
    expect(outcomes(run("slip", { ...seq, frames }))).toEqual([]);
  });

  test("a ducking head is not a slip, a slip is not a duck", () => {
    const duck = evaderSequence({ exerciseId: "slip", reps: [{ kneeAngle: 110, torsoLean: 25, durationMs: 900 }] });
    expect(run("slip", duck).filter((e) => e.type === "REP_STARTED")).toHaveLength(0);
    const slip = evaderSequence({ exerciseId: "duck", reps: [slipTo(30)] });
    expect(run("duck", slip).filter((e) => e.type === "REP_STARTED")).toHaveLength(0);
  });

  test("slipping with the neck only is cued; a body slip is not", () => {
    const neck = { slip: 8, neckTilt: 60, durationMs: 700 };
    expect(cues(run("slip", evaderSequence({ exerciseId: "slip", reps: [neck, neck] })))).toContain("neck_only");
    expect(cues(run("slip", evaderSequence({ exerciseId: "slip", reps: [slipTo(25), slipTo(-25)] })))).not.toContain("neck_only");
  });

  test("dropping one hand during the slip is cued", () => {
    const seq = evaderSequence({ exerciseId: "slip", dropSide: "right", reps: [{ slip: 25, guardDrop: 1, durationMs: 1200 }] });
    expect(cues(run("slip", seq))).toContain("guard_dropped");
  });
});

describe("duck", () => {
  test("deep ducks count, a shallow knee bend does not", () => {
    const deep = { kneeAngle: 110, torsoLean: 25, durationMs: 900 };
    const seq = evaderSequence({ exerciseId: "duck", reps: [deep, deep, { kneeAngle: 125, torsoLean: 15, durationMs: 900 }] });
    expect(outcomes(run("duck", seq))).toEqual(["valid", "valid", "incomplete"]);
  });
});

describe("ready pose and noise", () => {
  test("guard with the head centered is the ready pose; hands down or head off-center is not", () => {
    for (const [params, expected] of [
      [{}, 1],
      [{ guardDrop: 1 }, 0],
      [{ slip: 15 }, 0],
    ] as const) {
      const engine = new ExerciseEngine(load("slip"), { view: "front", nearSide: "left" });
      const ev: EngineEvent[] = [];
      for (let t = 0; t <= 1500; t += 33) ev.push(...engine.push(evaderFrame(params, { view: "front", t })));
      expect(ev.filter((e) => e.type === "READY_POSE_HELD"), JSON.stringify(params)).toHaveLength(expected);
    }
  });

  test("standing in guard with landmark jitter counts nothing; slips still count with it", () => {
    for (const id of IDS) {
      const still = evaderSequence({ exerciseId: id, reps: [], leadInMs: 6000, noise: 0.006, seed: 7 });
      expect(run(id, still).filter((e) => e.type === "REP_STARTED"), id).toHaveLength(0);
    }
    const seq = evaderSequence({ exerciseId: "slip", noise: 0.006, seed: 3, reps: [slipTo(25), slipTo(-25), slipTo(25)] });
    expect(outcomes(run("slip", seq))).toEqual(["valid", "valid", "valid"]);
  });
});
