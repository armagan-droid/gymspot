import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EngineEvent, LandmarkSequence, RulePack } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { ExerciseEngine, loadRulePack, measureDemonstration, suggestFault, suggestRep } from "../src/index";
import { evaderSequence, playSequence, squatSequence } from "../src/testing/index";

// AC-11.6: suggestions from demonstrations (specs/11 "Öneri algoritması").

const raw = (id: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8")) as RulePack;

/** A blank starter: the pack's smoothing and camera, no measures of its own. */
const blank = (id: string): RulePack => ({ ...raw(id), metrics: {}, faults: [] });

function countWith(base: RulePack, s: ReturnType<typeof suggestRep>, seq: LandmarkSequence, view: "front" | "side"): EngineEvent[] {
  const pack = { ...base, metrics: { ...base.metrics, [s!.metric]: s!.definition }, rep: s!.rep, readyPose: `${s!.metric} > -1000000 for 100ms`, faults: [] };
  const engine = new ExerciseEngine(loadRulePack(pack), { view, nearSide: "left" });
  return playSequence(seq, (f) => engine.push(f));
}
const reps = (ev: EngineEvent[]) => ev.filter((e) => e.type === "REP_COMPLETED");

describe("repetition measure and zones", () => {
  test("squats from the side: the knee angle, decreasing, and the suggested pack counts the same reps", () => {
    const seq = squatSequence({ view: "side", noise: 0.003, seed: 2, reps: [{ kneeAngle: 85 }, { kneeAngle: 80 }, { kneeAngle: 90 }, { kneeAngle: 82 }] });
    const s = suggestRep(measureDemonstration(seq.frames, blank("squat"), "side", "left"))!;
    expect(s.metric).toBe("knee_angle");
    expect(s.direction).toBe("down");
    expect(s.cycles).toBe(4);
    const { start, target } = s.rep;
    expect(start.exit).toBeLessThan(start.enter);
    expect(target.exit).toBeGreaterThan(target.enter);
    expect(target.exit).toBeLessThan(start.exit);
    expect(target.enter).toBeGreaterThan(85); // every demonstrated rep reaches it
    expect(reps(countWith(blank("squat"), s, seq, "side")).map((e) => e.type === "REP_COMPLETED" && e.outcome)).toEqual(["valid", "valid", "valid", "valid"]);
  });

  test("slips from the front: a head measure, and the pack counts them", () => {
    const seq = evaderSequence({ exerciseId: "slip", noise: 0.002, seed: 4, reps: [25, 25, 28, 24].map((slip) => ({ slip, durationMs: 800 })) });
    const s = suggestRep(measureDemonstration(seq.frames, blank("slip_left"), "front", "left"))!;
    expect(s.metric).toMatch(/^head_lean/);
    expect(reps(countWith(blank("slip_left"), s, seq, "front"))).toHaveLength(4);
  });

  test("the pack's own measure is used when it is the best one", () => {
    const seq = squatSequence({ view: "side", reps: [{ kneeAngle: 85 }, { kneeAngle: 85 }, { kneeAngle: 85 }] });
    const s = suggestRep(measureDemonstration(seq.frames, raw("squat"), "side", "left"))!;
    expect(s.metric).toBe("knee_angle_near");
  });

  test("standing still or a single rep suggests nothing", () => {
    const still = squatSequence({ view: "side", reps: [], leadInMs: 5000, noise: 0.004, seed: 9 });
    expect(suggestRep(measureDemonstration(still.frames, blank("squat"), "side", "left"))).toBeNull();
    const one = squatSequence({ view: "side", reps: [{ kneeAngle: 80 }] });
    expect(suggestRep(measureDemonstration(one.frames, blank("squat"), "side", "left"))).toBeNull();
  });
});

describe("fault condition", () => {
  const good = squatSequence({ view: "side", noise: 0.002, seed: 5, reps: [{ kneeAngle: 82 }, { kneeAngle: 80 }, { kneeAngle: 85 }] });
  const measure = (seq: LandmarkSequence) => measureDemonstration(seq.frames, blank("squat"), "side", "left");

  test("shallow squats: the knee angle at the turn, higher than in the good ones", () => {
    const shallow = squatSequence({ view: "side", noise: 0.002, seed: 6, reps: [{ kneeAngle: 125 }, { kneeAngle: 120 }, { kneeAngle: 128 }] });
    const rep = suggestRep(measure(good))!;
    const f = suggestFault(measure(good), measure(shallow), rep)!;
    expect(f.op).toBe(">");
    expect(Math.max(...f.good)).toBeLessThan(f.threshold);
    expect(Math.min(...f.bad)).toBeGreaterThan(f.threshold);
    expect(f.check).toBe(`at_turn: ${f.metric} > ${f.threshold}`);
    // the suggested check flags the shallow reps and not the good ones
    const pack = { ...blank("squat"), metrics: { [rep.metric]: rep.definition, [f.metric]: f.definition }, rep: rep.rep, readyPose: `${rep.metric} > 0 for 100ms` };
    pack.faults = [{ id: "shallow", name: { tr: "Sığ", en: "Shallow" }, severity: "minor", check: f.check, cue: { tr: "In", en: "Down" }, affectsValidity: true, cooldownMs: 0, minConsecutiveReps: 1 }];
    const run = (seq: LandmarkSequence) => {
      const engine = new ExerciseEngine(loadRulePack(pack), { view: "side", nearSide: "left" });
      return reps(playSequence(seq, (fr) => engine.push(fr))).map((e) => e.type === "REP_COMPLETED" && e.faults.includes("shallow"));
    };
    expect(run(good)).toEqual([false, false, false]);
    expect(run(shallow).every(Boolean)).toBe(true);
  });

  test("leaning forward: a torso or hip measure tells it apart", () => {
    const lean = squatSequence({ view: "side", noise: 0.002, seed: 7, reps: [{ kneeAngle: 82, torsoLean: 60 }, { kneeAngle: 80, torsoLean: 62 }, { kneeAngle: 84, torsoLean: 58 }] });
    const f = suggestFault(measure(good), measure(lean), suggestRep(measure(good))!)!;
    expect(f.metric).toMatch(/torso|hip/);
  });

  test("the same movement twice: no difference, no suggestion", () => {
    const again = squatSequence({ view: "side", noise: 0.002, seed: 8, reps: [{ kneeAngle: 82 }, { kneeAngle: 80 }, { kneeAngle: 85 }] });
    expect(suggestFault(measure(good), measure(again), suggestRep(measure(good))!)).toBeNull();
  });
});
